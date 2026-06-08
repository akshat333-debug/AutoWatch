import "server-only";
import { inngest } from "./client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gemini, MODEL_DIGEST } from "@/lib/gemini";
import { getOrgOwnerEmail } from "@/lib/resend";
import { Resend } from "resend";

// ── Daily digest cron ─────────────────────────────────────────────────────────
// Runs once per day at 07:00 UTC. For every org that had activity in the last
// 24 hours (or has open alerts), generates a plain-English narrative using
// Gemini 3.5 Flash and emails it to the org owner via Resend.

export const dailyDigest = inngest.createFunction(
  {
    id: "daily-digest",
    retries: 1,
    triggers: [{ cron: "0 7 * * *" }],
  },
  async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ── 1. Find all orgs with activity OR open alerts in the last 24h ─────────
    const { data: activeOrgIds } = await supabaseAdmin
      .from("events")
      .select("org_id")
      .gte("occurred_at", since);

    const { data: alertOrgIds } = await supabaseAdmin
      .from("alerts")
      .select("org_id")
      .eq("resolved", false)
      .gte("created_at", since);

    const orgIdSet = new Set<string>([
      ...((activeOrgIds ?? []).map((r) => r.org_id as string)),
      ...((alertOrgIds ?? []).map((r) => r.org_id as string)),
    ]);

    if (orgIdSet.size === 0) {
      return { processed: 0 };
    }

    let processed = 0;
    let errors = 0;

    for (const orgId of orgIdSet) {
      try {
        await sendDigestForOrg(orgId, since);
        processed++;
      } catch (err) {
        errors++;
        console.error(
          `[daily-digest] failed for org ${orgId}:`,
          err instanceof Error ? err.message : err
        );
        // Don't let one org's failure block the rest
      }
    }

    return { processed, errors, total: orgIdSet.size };
  }
);

// ── Per-org digest ─────────────────────────────────────────────────────────────

async function sendDigestForOrg(orgId: string, since: string): Promise<void> {
  // ── 1. Fetch events + summaries for the last 24h ──────────────────────────
  const { data: eventRows } = await supabaseAdmin
    .from("events")
    .select(
      "id, is_error, action_type, object_type, object_count, target_system, occurred_at, endpoint_id, endpoints(label)"
    )
    .eq("org_id", orgId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(100);

  const { data: summaryRows } = await supabaseAdmin
    .from("summaries")
    .select("event_id, text")
    .eq("org_id", orgId)
    .in(
      "event_id",
      (eventRows ?? []).map((e) => e.id as string)
    );

  // Build summary lookup
  const summaryByEventId = new Map(
    (summaryRows ?? []).map((s) => [s.event_id as string, s.text as string])
  );

  // ── 2. Fetch open alerts ──────────────────────────────────────────────────
  const { data: openAlerts } = await supabaseAdmin
    .from("alerts")
    .select("kind, message, severity, created_at, endpoints(label)")
    .eq("org_id", orgId)
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(10);

  const events = eventRows ?? [];
  const alerts = openAlerts ?? [];

  if (events.length === 0 && alerts.length === 0) return;

  // ── 3. Build stats breakdown by endpoint ─────────────────────────────────
  const byEndpoint = new Map<string, { label: string; count: number; errors: number }>();
  for (const ev of events) {
    const ep = ev.endpoints as { label: string } | null;
    const label = ep?.label ?? "Unknown";
    const key = (ev.endpoint_id as string) ?? label;
    const existing = byEndpoint.get(key) ?? { label, count: 0, errors: 0 };
    existing.count++;
    if (ev.is_error) existing.errors++;
    byEndpoint.set(key, existing);
  }

  // ── 4. Build summary text list for the LLM prompt ─────────────────────────
  const summaryLines = events
    .slice(0, 30) // cap for prompt length
    .map((ev) => {
      const s = summaryByEventId.get(ev.id as string);
      if (s) return `- ${s}`;
      // Fallback: structured fields
      if (ev.action_type && ev.object_type) {
        const count = ev.object_count != null ? ` ${ev.object_count}` : "";
        return `- ${capitalise(ev.action_type)}${count} ${ev.object_type}${count !== " 1" ? "s" : ""}${ev.target_system ? ` in ${ev.target_system}` : ""}`;
      }
      return null;
    })
    .filter(Boolean)
    .join("\n");

  const breakdownText = Array.from(byEndpoint.values())
    .map((ep) => `${ep.label}: ${ep.count} event${ep.count !== 1 ? "s" : ""}${ep.errors > 0 ? ` (${ep.errors} error${ep.errors !== 1 ? "s" : ""})` : ""}`)
    .join(", ");

  const alertText =
    alerts.length > 0
      ? alerts.map((a) => {
          const ep = a.endpoints as { label: string } | null;
          return `${a.kind}: ${ep?.label ?? "unknown"} — ${a.message}`;
        }).join("\n")
      : "none";

  // ── 5. Generate narrative with Gemini 3.5 Flash ───────────────────────────
  let narrative = "";
  try {
    const prompt = `You are AutoWatch, a monitoring tool for no-code automations (Zapier, Make, n8n).
Write a 2-3 sentence daily digest narrative. Be concise, factual, and use numbers.
Do NOT use markdown, bullet points, or headings. Plain sentences only.

Data for the last 24 hours:
- Total events: ${events.length}
- Automations active: ${byEndpoint.size}
- Breakdown: ${breakdownText || "no activity"}
- Error events: ${events.filter((e) => e.is_error).length}
- Open alerts: ${alerts.length > 0 ? alertText : "none"}

Recent event summaries:
${summaryLines || "(none)"}

Example output: "Your automations ran smoothly today with 47 events across 3 workflows. HubSpot CRM sync led with 23 contact updates. You have 1 open stalled alert on Lead Intake that needs attention."`;

    const response = await gemini.models.generateContent({
      model: MODEL_DIGEST,
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 256,
      },
    });

    narrative = response.text?.trim() ?? "";
  } catch (geminiErr) {
    // Fallback: compose narrative from data without LLM
    console.error("[daily-digest] Gemini failed (non-fatal), using fallback narrative:", geminiErr instanceof Error ? geminiErr.message : geminiErr);
    narrative =
      events.length > 0
        ? `Your automations had ${events.length} event${events.length !== 1 ? "s" : ""} in the last 24 hours across ${byEndpoint.size} automation${byEndpoint.size !== 1 ? "s" : ""}.`
        : "";
    if (alerts.length > 0) {
      narrative += ` You have ${alerts.length} open alert${alerts.length !== 1 ? "s" : ""} requiring attention.`;
    }
  }

  // ── 6. Find org owner email ───────────────────────────────────────────────
  const ownerEmail = await getOrgOwnerEmail(orgId);
  if (!ownerEmail) {
    console.warn(`[daily-digest] no owner email for org ${orgId}, skipping`);
    return;
  }

  // ── 7. Send digest email ──────────────────────────────────────────────────
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://autowatch.vercel.app";
  const from =
    process.env.RESEND_FROM_EMAIL ??
    "AutoWatch <onboarding@resend.dev>";

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from,
    to: ownerEmail,
    subject: `Your AutoWatch digest — ${today}`,
    html: buildDigestHtml({
      narrative,
      events,
      byEndpoint,
      alerts,
      summaryByEventId,
      siteUrl,
      today,
    }),
  });
}

// ── HTML email builder ────────────────────────────────────────────────────────

interface EvRow {
  id: unknown;
  is_error: boolean | null;
  occurred_at: string | null;
  endpoints: { label: string } | null;
}

function buildDigestHtml({
  narrative,
  events,
  byEndpoint,
  alerts,
  summaryByEventId,
  siteUrl,
  today,
}: {
  narrative: string;
  events: EvRow[];
  byEndpoint: Map<string, { label: string; count: number; errors: number }>;
  alerts: Array<{ kind: string; message: string; severity: string; endpoints: { label: string } | null }>;
  summaryByEventId: Map<string, string>;
  siteUrl: string;
  today: string;
}): string {
  // Breakdown rows
  const breakdownRows = Array.from(byEndpoint.values())
    .map(
      (ep) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#111;">${ep.label}</td>
          <td style="padding:6px 0;color:#111;text-align:right;">${ep.count}</td>
          <td style="padding:6px 0 6px 12px;color:${ep.errors > 0 ? "#e53e3e" : "#666"};text-align:right;">
            ${ep.errors > 0 ? `${ep.errors} error${ep.errors !== 1 ? "s" : ""}` : "—"}
          </td>
        </tr>`
    )
    .join("");

  // Recent events (up to 10)
  const recentRows = events
    .slice(0, 10)
    .map((ev) => {
      const summary =
        summaryByEventId.get(ev.id as string) ??
        (ev.endpoints?.label ?? "Event");
      const time = ev.occurred_at
        ? new Date(ev.occurred_at).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "";
      const errorDot = ev.is_error
        ? `<span style="color:#e53e3e;margin-right:4px;">●</span>`
        : "";
      return `
        <tr>
          <td style="padding:5px 12px 5px 0;color:#666;white-space:nowrap;font-size:12px;">${time}</td>
          <td style="padding:5px 0;color:#111;font-size:13px;">${errorDot}${summary}</td>
        </tr>`;
    })
    .join("");

  // Alert rows
  const alertRows =
    alerts.length > 0
      ? alerts
          .slice(0, 5)
          .map((a) => {
            const ep = a.endpoints;
            const emoji = a.severity === "critical" ? "🔴" : "🟡";
            return `
              <tr>
                <td style="padding:5px 0;color:#111;font-size:13px;">
                  ${emoji} <strong>${ep?.label ?? "Automation"}</strong> — ${a.message}
                </td>
              </tr>`;
          })
          .join("")
      : `<tr><td style="padding:5px 0;color:#666;font-size:13px;">No open alerts — all automations running smoothly.</td></tr>`;

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="margin-top:0;font-size:20px;color:#111;">📊 AutoWatch Digest — ${today}</h2>

      ${narrative ? `<p style="color:#444;line-height:1.6;margin-bottom:24px;">${narrative}</p>` : ""}

      ${
        byEndpoint.size > 0
          ? `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#666;margin-bottom:8px;">Automations</h3>
             <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
               <thead>
                 <tr>
                   <th style="padding:0 12px 6px 0;text-align:left;font-size:12px;color:#999;font-weight:500;">Automation</th>
                   <th style="padding:0 0 6px;text-align:right;font-size:12px;color:#999;font-weight:500;">Events</th>
                   <th style="padding:0 0 6px 12px;text-align:right;font-size:12px;color:#999;font-weight:500;">Errors</th>
                 </tr>
               </thead>
               <tbody>${breakdownRows}</tbody>
             </table>`
          : ""
      }

      ${
        events.length > 0
          ? `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#666;margin-bottom:8px;">Recent Events</h3>
             <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
               <tbody>${recentRows}</tbody>
             </table>`
          : ""
      }

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#666;margin-bottom:8px;">Open Alerts</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
        <tbody>${alertRows}</tbody>
      </table>

      <a
        href="${siteUrl}/dashboard"
        style="display:inline-block;background:#111;color:#fff;text-decoration:none;
               padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500;"
      >
        View Dashboard →
      </a>

      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#999;font-size:12px;margin:0;">
        AutoWatch daily digest. You're receiving this because you're monitoring automations on AutoWatch.
      </p>
    </div>
  `;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
