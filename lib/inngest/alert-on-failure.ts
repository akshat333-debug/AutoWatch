import "server-only";
import { inngest } from "./client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAlertEmail, getOrgOwnerEmail } from "@/lib/resend";

// ── Alert on failure ──────────────────────────────────────────────────────────
// Triggered by the same "event/ingested" event as the summarizer.
// If the event has is_error=true, inserts an alert row and sends an email.
//
// Dedup strategy (MVP): one alert per error event. If an endpoint is
// consistently erroring, the owner will see multiple alerts in the inbox.
// Per-endpoint dedup / batching can be added later if alert fatigue is an issue.

export const alertOnFailure = inngest.createFunction(
  {
    id: "alert-on-failure",
    retries: 2,
    triggers: [{ event: "event/ingested" }],
  },
  async ({ event }) => {
    const { eventId } = event.data as { eventId: string };

    // ── 1. Fetch event ────────────────────────────────────────────────────────
    const { data: row, error: fetchError } = await supabaseAdmin
      .from("events")
      .select("id, org_id, endpoint_id, is_error")
      .eq("id", eventId)
      .single();

    if (fetchError || !row) {
      // Event not found — don't throw (summarize will also fail and retry).
      return { skipped: true, reason: "event_not_found" };
    }

    // ── 2. Short-circuit: not an error event ─────────────────────────────────
    if (!row.is_error) {
      return { skipped: true, reason: "not_an_error" };
    }

    // ── 3. Fetch endpoint label ───────────────────────────────────────────────
    const { data: endpoint } = await supabaseAdmin
      .from("endpoints")
      .select("label")
      .eq("id", row.endpoint_id)
      .single();

    const endpointLabel = endpoint?.label ?? "Unknown automation";
    const message = `A failure event was received from "${endpointLabel}".`;

    // ── 4. Insert alert row ───────────────────────────────────────────────────
    // org_id set explicitly — service-role bypasses RLS.
    const { data: alert, error: alertError } = await supabaseAdmin
      .from("alerts")
      .insert({
        org_id: row.org_id,
        endpoint_id: row.endpoint_id,
        kind: "failure",
        message,
        severity: "warning",
      })
      .select("id")
      .single();

    if (alertError) {
      throw new Error(
        `[alert-on-failure] insert alert failed: ${alertError.message}`
      );
    }

    // ── 5. Send alert email ───────────────────────────────────────────────────
    // Best-effort: don't let email failure block the alert row being recorded.
    if (process.env.RESEND_API_KEY) {
      const ownerEmail = await getOrgOwnerEmail(row.org_id);
      if (ownerEmail) {
        try {
          await sendAlertEmail({
            to: ownerEmail,
            endpointLabel,
            kind: "failure",
            message,
            severity: "warning",
          });
        } catch (emailErr: unknown) {
          console.error(
            "[alert-on-failure] email send failed (non-fatal):",
            emailErr instanceof Error ? emailErr.message : emailErr
          );
        }
      }
    }

    return { alertId: alert.id, eventId };
  }
);
