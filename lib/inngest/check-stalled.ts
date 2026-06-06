import "server-only";
import { inngest } from "./client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAlertEmail, getOrgOwnerEmail } from "@/lib/resend";

// ── Stalled detection cron ────────────────────────────────────────────────────
// Runs every 5 minutes. For each active endpoint with expected_interval_seconds
// set, checks whether the last event arrived within that interval. If not, and
// there is no existing unresolved "stalled" alert for that endpoint, creates one
// and emails the org owner.
//
// Dedup: one unresolved stalled alert per endpoint at a time. Once the owner
// resolves it (or new events arrive), a new one can fire.

export const checkStalled = inngest.createFunction(
  {
    id: "check-stalled",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async () => {
    // ── 1. Find all active endpoints with an expected interval ────────────────
    const { data: endpoints, error: endpointsError } = await supabaseAdmin
      .from("endpoints")
      .select("id, org_id, label, expected_interval_seconds, created_at")
      .eq("is_active", true)
      .not("expected_interval_seconds", "is", null);

    if (endpointsError) {
      throw new Error(
        `[check-stalled] endpoints query failed: ${endpointsError.message}`
      );
    }

    if (!endpoints || endpoints.length === 0) {
      return { checked: 0, alertsCreated: 0 };
    }

    let alertsCreated = 0;

    for (const ep of endpoints) {
      const intervalMs = (ep.expected_interval_seconds as number) * 1000;
      const now = Date.now();

      // ── 2. Find most recent event for this endpoint ───────────────────────
      const { data: lastEvent } = await supabaseAdmin
        .from("events")
        .select("occurred_at")
        .eq("endpoint_id", ep.id)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let isStalled = false;

      if (lastEvent?.occurred_at) {
        // Has events — check if the most recent is too old
        const lastMs = new Date(lastEvent.occurred_at).getTime();
        isStalled = now - lastMs > intervalMs;
      } else {
        // No events ever — use endpoint creation time as the baseline
        const createdMs = new Date(ep.created_at as string).getTime();
        isStalled = now - createdMs > intervalMs;
      }

      if (!isStalled) continue;

      // ── 3. Skip if there's already an unresolved stalled alert ──────────
      const { data: existingAlert } = await supabaseAdmin
        .from("alerts")
        .select("id")
        .eq("endpoint_id", ep.id)
        .eq("kind", "stalled")
        .eq("resolved", false)
        .limit(1)
        .maybeSingle();

      if (existingAlert) continue;

      // ── 4. Insert stalled alert ──────────────────────────────────────────
      const intervalLabel = formatInterval(ep.expected_interval_seconds as number);
      const message = `"${ep.label}" has not sent any events in the last ${intervalLabel}. It may be stalled or broken.`;

      const { data: alert, error: alertError } = await supabaseAdmin
        .from("alerts")
        .insert({
          org_id: ep.org_id,
          endpoint_id: ep.id,
          kind: "stalled",
          message,
          severity: "critical",
        })
        .select("id")
        .single();

      if (alertError) {
        console.error(
          `[check-stalled] alert insert failed for endpoint ${ep.id}:`,
          alertError.message
        );
        continue; // Don't let one bad endpoint block the rest
      }

      alertsCreated++;

      // ── 5. Send alert email ──────────────────────────────────────────────
      if (process.env.RESEND_API_KEY) {
        const ownerEmail = await getOrgOwnerEmail(ep.org_id as string);
        if (ownerEmail) {
          try {
            await sendAlertEmail({
              to: ownerEmail,
              endpointLabel: ep.label as string,
              kind: "stalled",
              message,
              severity: "critical",
            });
          } catch (emailErr: unknown) {
            console.error(
              `[check-stalled] email failed for endpoint ${ep.id} (non-fatal):`,
              emailErr instanceof Error ? emailErr.message : emailErr
            );
          }
        }
      }

      console.log(`[check-stalled] created stalled alert ${alert.id} for endpoint ${ep.id}`);
    }

    return { checked: endpoints.length, alertsCreated };
  }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format an interval in seconds as a human-readable string. */
function formatInterval(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}
