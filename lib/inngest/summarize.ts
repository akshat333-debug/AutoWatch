import "server-only";
import { inngest } from "./client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { anthropic, MODEL_SUMMARY } from "@/lib/anthropic";

// ── System prompt ─────────────────────────────────────────────────────────────
// Cached on the system slot (cache_control added below).
// Haiku 4.5 minimum cacheable prefix is 4096 tokens; this prompt is shorter,
// so the cache silently won't activate until the prompt grows. That's fine —
// no harm, and cost is already low on Haiku.
const SYSTEM_PROMPT = `\
You are an automation event summarizer for AutoWatch.
Given a raw webhook payload from a no-code automation (Zapier, Make, n8n, or similar),
return ONLY a JSON object — no markdown, no code blocks, no explanation.

Fields:
- "summary": One plain-English sentence under 100 chars. What happened?
  Examples: "Updated 47 contacts in HubSpot", "Sent invoice #1042 to customer",
  "Created 3 Trello cards from new leads", "Zap triggered with no records found"
- "action_type": Main verb. One of: created | updated | deleted | sent | triggered |
  processed | failed | other
- "object_type": What was acted on. One of: contact | invoice | email | task | record |
  file | lead | order | message | other
- "object_count": Integer count of items affected, or null if unknown
- "target_system": Destination system name (e.g. "HubSpot", "Trello", "Slack",
  "Gmail"), or null if unclear

Respond ONLY with a valid JSON object on a single line.`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedSummary {
  summary: string;
  action_type: string | null;
  object_type: string | null;
  object_count: number | null;
  target_system: string | null;
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const summarize = inngest.createFunction(
  {
    id: "summarize-event",
    retries: 3,
    triggers: [{ event: "event/ingested" }],
  },
  async ({ event }) => {
    const { eventId } = event.data as { eventId: string };

    // ── 1. Fetch event ────────────────────────────────────────────────────────
    const { data: row, error: fetchError } = await supabaseAdmin
      .from("events")
      .select("id, org_id, raw_payload, status")
      .eq("id", eventId)
      .single();

    if (fetchError || !row) {
      throw new Error(
        `[summarize] event ${eventId} not found: ${fetchError?.message ?? "no data"}`
      );
    }

    // Idempotency: skip if already summarized (e.g. duplicate Inngest delivery)
    if (row.status === "summarized") {
      return { skipped: true, eventId };
    }

    // ── 2. Call Haiku 4.5 ─────────────────────────────────────────────────────
    // Per CLAUDE.md: Haiku 4.5 for per-event work; never Sonnet/Opus inline.
    // Do NOT log raw_payload — it may contain customer PII.
    const response = await anthropic.messages.create({
      model: MODEL_SUMMARY,
      max_tokens: 256,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Summarize this automation event payload:\n\n${JSON.stringify(
            row.raw_payload,
            null,
            2
          )}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(`[summarize] no text block in Haiku response for event ${eventId}`);
    }

    // ── 3. Parse structured JSON response ─────────────────────────────────────
    let parsed: ParsedSummary;
    try {
      parsed = JSON.parse(textBlock.text) as ParsedSummary;
    } catch {
      // Fallback: treat raw text as the summary with null structured fields.
      // This lets the retry have a chance to fix it; this path is still useful
      // as a last resort after all retries.
      parsed = {
        summary: textBlock.text.trim().slice(0, 200),
        action_type: null,
        object_type: null,
        object_count: null,
        target_system: null,
      };
    }

    const summaryText = (parsed.summary ?? textBlock.text.trim()).slice(0, 500);

    // Coerce object_count to a valid integer or null
    const objectCount =
      parsed.object_count !== null && parsed.object_count !== undefined
        ? parseInt(String(parsed.object_count), 10)
        : null;
    const safeObjectCount =
      objectCount !== null && Number.isFinite(objectCount) ? objectCount : null;

    // ── 4. Insert summary row ─────────────────────────────────────────────────
    // org_id set explicitly — service-role bypasses RLS.
    const { error: summaryError } = await supabaseAdmin.from("summaries").insert({
      event_id: eventId,
      org_id: row.org_id,
      text: summaryText,
      model: MODEL_SUMMARY,
    });

    if (summaryError) {
      // 23505 = unique constraint violation: already inserted (idempotent OK)
      if (summaryError.code !== "23505") {
        throw new Error(`[summarize] insert summary failed: ${summaryError.message}`);
      }
    }

    // ── 5. Update event: structured fields + status ───────────────────────────
    // org_id filter ensures we never touch another org's event.
    const { error: updateError } = await supabaseAdmin
      .from("events")
      .update({
        status: "summarized",
        action_type: parsed.action_type ?? null,
        object_type: parsed.object_type ?? null,
        object_count: safeObjectCount,
        target_system: parsed.target_system ?? null,
      })
      .eq("id", eventId)
      .eq("org_id", row.org_id);

    if (updateError) {
      throw new Error(`[summarize] event update failed: ${updateError.message}`);
    }

    return { eventId, summary: summaryText };
  }
);
