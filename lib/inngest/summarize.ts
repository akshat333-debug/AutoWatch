import "server-only";
import { inngest } from "./client";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gemini, MODEL_SUMMARY } from "@/lib/gemini";

// ── System prompt ─────────────────────────────────────────────────────────────
// Sent as Gemini systemInstruction. We also set responseMimeType to
// application/json on the request, which constrains the model to emit valid
// JSON — so the parse below is reliable (the fallback stays as defence in depth).
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

    // ── 2. Call Gemini Flash-Lite ─────────────────────────────────────────────
    // Per CLAUDE.md cost rule: cheap Flash-tier model for per-event work.
    // responseMimeType=application/json constrains output to valid JSON.
    // Do NOT log raw_payload — it may contain customer PII.
    const response = await gemini.models.generateContent({
      model: MODEL_SUMMARY,
      contents: `Summarize this automation event payload:\n\n${JSON.stringify(
        row.raw_payload,
        null,
        2
      )}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0,
        maxOutputTokens: 256,
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error(`[summarize] empty Gemini response for event ${eventId}`);
    }

    // ── 3. Parse structured JSON response ─────────────────────────────────────
    let parsed: ParsedSummary;
    try {
      parsed = JSON.parse(responseText) as ParsedSummary;
    } catch {
      // Fallback: treat raw text as the summary with null structured fields.
      // This lets the retry have a chance to fix it; this path is still useful
      // as a last resort after all retries.
      parsed = {
        summary: responseText.trim().slice(0, 200),
        action_type: null,
        object_type: null,
        object_count: null,
        target_system: null,
      };
    }

    const summaryText = (parsed.summary ?? responseText.trim()).slice(0, 500);

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
