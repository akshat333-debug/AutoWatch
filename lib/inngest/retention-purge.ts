import "server-only";
import { inngest } from "./client";
import { supabaseAdmin } from "@/lib/supabase-admin";

// ── Retention purge cron ──────────────────────────────────────────────────────
// Runs daily at 03:00 UTC — offset from the 07:00 digest cron.
// For each org, bulk-updates raw_payload to {} for events older than the org's
// retention_days. This removes PII-bearing payloads while preserving event rows
// (and their summaries) for statistics and audit trail.
//
// raw_payload is NOT NULL in the schema, so we replace with an empty object
// rather than deleting the column. The {"_purged":true} marker lets code
// distinguish purged rows from events with genuinely empty payloads.

export const retentionPurge = inngest.createFunction(
  {
    id: "retention-purge",
    retries: 1,
    triggers: [{ cron: "0 3 * * *" }],
  },
  async () => {
    // ── 1. Fetch all orgs with their retention_days setting ───────────────────
    const { data: orgs, error: orgsError } = await supabaseAdmin
      .from("orgs")
      .select("id, retention_days");

    if (orgsError) {
      throw new Error(`[retention-purge] orgs query failed: ${orgsError.message}`);
    }

    if (!orgs || orgs.length === 0) {
      return { orgsProcessed: 0, rowsPurged: 0 };
    }

    let rowsPurged = 0;

    for (const org of orgs) {
      const retentionDays = (org.retention_days as number) ?? 30;
      const cutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000
      ).toISOString();

      // ── 2. Find IDs of events to purge for this org ───────────────────────
      // Only target rows where raw_payload hasn't already been purged
      // (i.e., where the _purged marker is absent). This avoids touching rows
      // on every run and keeps the UPDATE set small.
      const { data: toPurge, error: selectError } = await supabaseAdmin
        .from("events")
        .select("id")
        .eq("org_id", org.id)
        .lt("occurred_at", cutoff)
        .not("raw_payload", "eq", '{"_purged":true}')
        .limit(500); // process in batches to avoid timeouts

      if (selectError) {
        console.error(
          `[retention-purge] select failed for org ${org.id}:`,
          selectError.message
        );
        continue;
      }

      if (!toPurge || toPurge.length === 0) continue;

      const ids = toPurge.map((r) => r.id as string);

      // ── 3. Overwrite raw_payload with purge marker ────────────────────────
      const { error: updateError, count } = await supabaseAdmin
        .from("events")
        .update({ raw_payload: { _purged: true } })
        .in("id", ids);

      if (updateError) {
        console.error(
          `[retention-purge] update failed for org ${org.id}:`,
          updateError.message
        );
        continue;
      }

      rowsPurged += count ?? ids.length;
    }

    return { orgsProcessed: orgs.length, rowsPurged };
  }
);
