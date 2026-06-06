# CLAUDE.md

> Master instructions for Claude Code. Read this first, every session. Keep changes here in sync with `/docs`.

## What this project is

**AutoWatch** (working name) — a plain-English activity log + failure/anomaly alerting for a small business's **no-code automations** (Zapier, Make, n8n). It ingests webhook events from a user's automations, summarizes each into one human sentence ("Your CRM zap updated 47 contacts"), and alerts the owner when an automation breaks, stalls, or behaves abnormally. Optional compliance-style PDF export.

**It is NOT:** a tool that audits "every AI tool." We only audit automations the user explicitly instruments via a signed webhook endpoint. Do not write code or copy that implies broader capture than that.

**Positioning:** the painkiller is *catching automations when they break or go rogue*, not a passive diary. When in doubt, prioritize alerting/reliability features over logging cosmetics.

## Tech stack (pin these versions)

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **Supabase** (Postgres + Auth + Row-Level Security) — `@supabase/supabase-js`, `@supabase/ssr`
- **Inngest** — durable background jobs (summarize, anomaly, digest)
- **Google Gen AI SDK** (`@google/genai`) — `gemini-3.1-flash-lite` for per-event summaries, `gemini-3.5-flash` for daily digests. (Switched off Anthropic 2026-06-07 — Anthropic account had no credit; Gemini free tier gives 500 RPD on Flash-Lite. `lib/anthropic.ts` kept as a dormant fallback.)
- **Stripe** — Checkout + Billing Portal + webhook
- **Resend** — alert + digest emails
- **shadcn/ui + Tailwind** — UI
- **pdf-lib** — compliance export
- **@sentry/nextjs** — error tracking
- **Vercel** — hosting

## How to run / build / test

```bash
npm install
cp .env.example .env.local      # fill in values (see docs/SECURITY.md for which are server-only)
npm run dev                     # http://localhost:3000
npx supabase db push            # apply migrations
npm run build && npm run start  # prod build check
npm run lint && npm run typecheck
# Webhook testing locally: use a Vercel preview URL or a tunnel; send a signed POST (see docs/API.md)
# Stripe webhooks locally: stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Folder structure

```
app/
  (dashboard)/            # authenticated UI: events, alerts, settings, billing
  api/
    ingest/[key]/         # HMAC-verified webhook ingestion (returns 202, never calls LLM inline)
    stripe/webhook/       # Stripe events -> subscriptions table
    inngest/              # Inngest function endpoint
lib/
  supabase-admin.ts       # service-role client (server only, bypasses RLS)
  supabase-server.ts      # RLS-scoped client from user JWT
  inngest/                # summarize, anomaly, digest functions
  gemini.ts               # Gemini client + model constants (per-event LLM)
  anthropic.ts            # dormant fallback (unused since Gemini switch)
  hmac.ts                 # signature verify
supabase/migrations/      # SQL incl. RLS policies (source of truth = docs/SCHEMA.md)
docs/                     # PRD, ARCHITECTURE, DESIGN, API, SCHEMA, SECURITY, ERRORS
```

## Code style & conventions

- TypeScript **strict**; no `any` except at JSON parse boundaries (then validate with zod).
- Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`) **must never** be imported into client components. Guard with `import "server-only"`.
- All DB access for user-facing reads goes through the **RLS-scoped** client. Only background jobs use the service-role client, and they MUST set `org_id` explicitly on every query.
- The ingestion route returns `202` fast. **Never call the Anthropic API inline in a request handler** — enqueue an Inngest event.
- Validate all external input with zod before touching the DB.
- Prefer Stripe-hosted Checkout/Portal over custom billing UI.

## What NOT to do (hard rules)

1. **Never** ship an ingestion endpoint that trusts a URL path alone. Every ingest requires HMAC signature verification against the endpoint's `signing_secret`. See `docs/SECURITY.md`.
2. **Never** log or send raw event payloads to Sentry or any third party — they contain customer PII.
3. **Never** call a Pro-tier / expensive LLM per event (cost). Per-event summaries use a cheap **Flash-tier** model — currently `gemini-3.1-flash-lite` (`lib/gemini.ts`). Reserve more capable models for the once-daily digest only. (Cost rule is provider-agnostic: the original Anthropic form was Haiku-per-event, Sonnet-for-digest.)
4. **Never** implement anomaly detection as plain mean/stddev z-score — use the stalled + failure rules first (high signal), then MAD-based volume checks with a minimum baseline (see `docs/ARCHITECTURE.md`).
5. **Never** widen the product copy to claim we capture "every AI tool." Scope = instrumented automations only.
6. **Never** disable or skip RLS to "make it work." If a query fails under RLS, fix the policy, don't bypass it client-side.

## Environment notes

- Vercel function timeouts are why ingestion is async. Keep handlers fast.
- Inngest discovers functions via `/api/inngest`. Confirm it's registered after deploy.
- Enforce per-plan monthly event quota at the **ingestion edge** to cap the LLM bill.

## Where to start

Read `TASKS.md`. Build in phase order. Don't skip Phase 0 (schema + RLS) — retrofitting tenancy is painful. Current phase and status live in `TASKS.md`.

## Before /compact — always do this first

When I say "snapshot" or before any /compact, update this section:

### Current state snapshot

- **Last completed task:** Phase 3 pipeline debugged end-to-end + **switched LLM provider Anthropic → Gemini**. Two real bugs fixed during verification: (1) ingest `void inngest.send()` was killed when Vercel froze the function post-202 → now uses `next/server` `after()` (commit `170d1f4`); (2) Inngest app was never validly synced (signing-key mismatch) → fixed key + re-registered via `PUT /api/inngest` ("Successfully registered"). Then discovered Anthropic account had **no credit** ("credit balance too low") — so swapped per-event summarization to **Gemini `gemini-3.1-flash-lite`** via `@google/genai`.
- **In progress:** Awaiting `GEMINI_API_KEY` in Vercel env + redeploy + Inngest re-sync, then final milestone test.
- **Next task:** After user adds `GEMINI_API_KEY` to Vercel (Prod+Preview) and redeploys: re-sync Inngest (or `PUT /api/inngest`), send a signed test webhook, confirm a plain-English summary appears in the dashboard timeline. That closes the Phase 3 milestone.
- **Open decisions:** None blocking.
- **Errors in flight:** None in code. `npm run lint && npm run typecheck` clean. Production summarize will fail until `GEMINI_API_KEY` is set in Vercel (currently only in `.env.local`).
- **Key decisions made this session:**
  - Supabase project: `sucgnzxpljvkplcgvvyu`, region `ap-south-1`, free tier
  - Vercel project: `autowatch` → `https://autowatch.vercel.app`, linked to `akshat333-debug/AutoWatch` on GitHub, auto-deploy on push to `main`
  - Vercel project ID: `prj_uGFevaICkTB1ZNH22rVSVhM6B1t4`, team ID: `team_onpE0A5yfGkttI83BVeodE0B`
  - Sentry org: `akshat-qv`, project: `autowatch`, DSN set in Vercel + `.env.local`
  - Inngest app: `autowatch` on app.inngest.com; synced endpoint: `https://autowatch.vercel.app/api/inngest`; registered function: `summarize-event`
  - All Vercel production env vars set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
  - Auth: magic-link only (no password). `ensureOrgForUser` runs in `/auth/callback` — idempotent org + `org_members` creation via service-role client
  - Server action pattern: server actions return `void` and use `redirect()` for both success and error paths
  - Dashboard route group: `app/(dashboard)/` — layout double-checks auth server-side even though middleware also guards it
  - `lib/supabase-server.ts` = RLS-scoped (user JWT); `lib/supabase-admin.ts` = service-role (bypasses RLS, server-only)
  - Inngest v4 API: triggers go inside options object as `triggers: [{ event: "..." }]` — NOT a 3-arg createFunction call (v3 style breaks in v4)
  - **LLM provider: Gemini** (`@google/genai` v2.8.0). `lib/gemini.ts`: `MODEL_SUMMARY = "gemini-3.1-flash-lite"` (per-event; free tier 15 RPM / 500 RPD), `MODEL_DIGEST = "gemini-3.5-flash"` (Phase 6). Call shape: `gemini.models.generateContent({ model, contents, config: { systemInstruction, responseMimeType: "application/json", temperature: 0, maxOutputTokens: 256 } })` → read `response.text`. `responseMimeType: application/json` guarantees valid JSON. `lib/anthropic.ts` left dormant as fallback.
  - Ingest route enqueues via `next/server` `after(async () => inngest.send(...))` — NOT bare `void promise` (that gets killed when Vercel freezes the lambda after the 202)
  - `.mcp.json` added to project root: `inngest-dev` MCP server (curl → localhost:8288/mcp); `.claude/settings.json` auto-approves it
  - Inngest `summarize` function: idempotency on `status === "summarized"` + 23505 on summaries insert; JSON parse fallback; explicit `org_id` on all service-role queries
  - Vercel env vars still TODO: **`GEMINI_API_KEY`** (Prod + Preview). `ANTHROPIC_API_KEY` now unused in prod.
- **Phase history:**
  - Phase 0 ✅ — schema + RLS + Vercel deploy
  - Phase 1 ✅ — magic-link auth + dashboard shell
  - Phase 2 ✅ — endpoints create flow + HMAC ingest + event timeline (commits `b4efeef`, `7e805f0`, `bbaa40d`, `bff80f3`)
  - Phase 3 ✅ (code) — Inngest summarization pipeline; `after()` enqueue fix (`170d1f4`); provider switched to Gemini; milestone test pending on `GEMINI_API_KEY` in Vercel

After compact:
Read CLAUDE.md fully, especially this snapshot. Tell me what we were doing and what you're picking up next.