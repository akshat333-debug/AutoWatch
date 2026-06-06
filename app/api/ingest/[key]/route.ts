import "server-only";
import { type NextRequest, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyHmacSignature } from "@/lib/hmac";
import { inngest } from "@/lib/inngest/client";
import type { Json } from "@/lib/database.types";

// Ensure this route always runs in the Node.js runtime (needed for
// crypto.timingSafeEqual and Buffer) and is never statically optimised.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorCode =
  | "missing_signature"
  | "not_found"
  | "invalid_signature"
  | "quota_exceeded"
  | "invalid_json"
  | "server_error";

function err(code: ErrorCode, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  // ── 1. Buffer the raw body FIRST ─────────────────────────────────────────
  // Must happen before any other body access; we need the raw bytes for HMAC.
  const rawBody = Buffer.from(await request.arrayBuffer());

  // ── 2. Require X-Signature header ─────────────────────────────────────────
  const signatureHeader = request.headers.get("x-signature");
  if (!signatureHeader) {
    return err("missing_signature", "X-Signature header required", 401);
  }

  // ── 3. Resolve endpoint from URL key ──────────────────────────────────────
  const { key } = await params;

  const { data: endpoint } = await supabaseAdmin
    .from("endpoints")
    .select("id, org_id, signing_secret, is_active")
    .eq("endpoint_key", key)
    .single();

  // Treat missing OR explicitly inactive endpoints the same (no oracle attack)
  if (!endpoint || endpoint.is_active === false) {
    return err("not_found", "Endpoint not found", 404);
  }

  // ── 4. Verify HMAC (constant-time) ────────────────────────────────────────
  if (!verifyHmacSignature(endpoint.signing_secret, rawBody, signatureHeader)) {
    return err("invalid_signature", "Signature verification failed", 401);
  }

  // ── 5. Check monthly event quota ─────────────────────────────────────────
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [countResult, orgResult] = await Promise.all([
    supabaseAdmin
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("org_id", endpoint.org_id)
      .gte("created_at", startOfMonth.toISOString()),
    supabaseAdmin
      .from("orgs")
      .select("monthly_event_quota")
      .eq("id", endpoint.org_id)
      .single(),
  ]);

  const eventCount = countResult.count ?? 0;
  const quota = orgResult.data?.monthly_event_quota ?? Infinity;

  if (eventCount >= quota) {
    return err("quota_exceeded", "Monthly event quota exceeded", 429);
  }

  // ── 6. Parse JSON body ────────────────────────────────────────────────────
  // JSON.parse returns `any` — cast to Json for the DB insert.
  // Do NOT log or echo back the payload; it may contain customer PII.
  let payload: Json;
  try {
    payload = JSON.parse(rawBody.toString("utf-8")) as Json;
  } catch {
    return err("invalid_json", "Request body must be valid JSON", 400);
  }

  // ── 7. Extract optional dedup key and error signal ───────────────────────
  let dedup_key: string | null = null;
  let is_error = false;

  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const p = payload as Record<string, Json>;
    const rawId = p.id ?? p.event_id;
    if (typeof rawId === "string" || typeof rawId === "number") {
      dedup_key = String(rawId);
    }
    is_error =
      p.error === true || p.is_error === true || p.status === "error";
  }

  // ── 8. Persist event (idempotent on dedup_key) ───────────────────────────
  const { data: newEvent, error: insertError } = await supabaseAdmin
    .from("events")
    .insert({
      org_id: endpoint.org_id,
      endpoint_id: endpoint.id,
      raw_payload: payload,
      dedup_key,
      is_error,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError) {
    // Unique index violation on (org_id, dedup_key) → already stored; idempotent
    if (insertError.code === "23505") {
      return Response.json({ ok: true }, { status: 202 });
    }
    // Any other DB error: log server-side only, never echo payload
    console.error("[ingest] insert error:", insertError.code, insertError.message);
    return err("server_error", "Internal server error", 500);
  }

  // ── 9. Enqueue Inngest summarize job (after response) ────────────────────
  // `after()` runs after the 202 is sent but keeps the serverless function
  // alive until the callback settles — no risk of the promise being killed
  // mid-flight as with bare fire-and-forget (void promise).
  // If Inngest is unavailable, we log server-side only and the event stays
  // in "pending" status; no customer impact (event is already stored).
  if (newEvent?.id) {
    const eventId = newEvent.id;
    after(async () => {
      try {
        await inngest.send({ name: "event/ingested", data: { eventId } });
      } catch (enqueueErr: unknown) {
        console.error(
          "[ingest] inngest.send failed — event stored but not enqueued:",
          enqueueErr instanceof Error ? enqueueErr.message : enqueueErr
        );
      }
    });
  }

  return Response.json({ ok: true }, { status: 202 });
}
