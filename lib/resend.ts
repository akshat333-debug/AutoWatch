import "server-only";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Server-only: RESEND_API_KEY must never reach the client bundle.
// Lazy-init so missing key only throws at send time (not module load).
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("[resend] RESEND_API_KEY is not set");
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

// ── Email sender ──────────────────────────────────────────────────────────────

export interface AlertEmailPayload {
  to: string;
  endpointLabel: string;
  kind: string;
  message: string;
  severity: string;
}

const KIND_LABEL: Record<string, string> = {
  stalled: "Automation Stalled",
  failure: "Automation Failed",
  failure_spike: "Failure Spike Detected",
  volume_anomaly: "Volume Anomaly",
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

export async function sendAlertEmail(
  payload: AlertEmailPayload
): Promise<void> {
  const from =
    process.env.RESEND_FROM_EMAIL ??
    "AutoWatch Alerts <onboarding@resend.dev>";

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://autowatch.vercel.app";

  const emoji = SEVERITY_EMOJI[payload.severity] ?? "⚠️";
  const kindLabel = KIND_LABEL[payload.kind] ?? "Alert";

  await getResend().emails.send({
    from,
    to: payload.to,
    subject: `${emoji} ${kindLabel}: ${payload.endpointLabel}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #111; margin-top: 0;">${emoji} ${kindLabel}</h2>
        <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
          <tr>
            <td style="padding: 6px 12px 6px 0; color: #666; white-space: nowrap; vertical-align: top;">
              <strong>Automation</strong>
            </td>
            <td style="padding: 6px 0; color: #111;">${payload.endpointLabel}</td>
          </tr>
          <tr>
            <td style="padding: 6px 12px 6px 0; color: #666; white-space: nowrap; vertical-align: top;">
              <strong>Details</strong>
            </td>
            <td style="padding: 6px 0; color: #111;">${payload.message}</td>
          </tr>
        </table>
        <a
          href="${siteUrl}/dashboard/alerts"
          style="display: inline-block; background: #111; color: #fff; text-decoration: none;
                 padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500;"
        >
          View &amp; Resolve Alert →
        </a>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; margin: 0;">
          You're receiving this because an automation you monitor with AutoWatch fired an alert.
        </p>
      </div>
    `,
  });
}

// ── Org owner lookup ──────────────────────────────────────────────────────────
// Used by Inngest alert functions to find who to email.
// Returns the email of the first owner-role member of the org.

export async function getOrgOwnerEmail(orgId: string): Promise<string | null> {
  const { data: member } = await supabaseAdmin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .limit(1)
    .single();

  if (!member) return null;

  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(
    member.user_id
  );

  return userData.user?.email ?? null;
}
