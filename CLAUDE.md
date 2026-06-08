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

- **Last completed task:** Phase 4 ✅ code built + verified end-to-end (commit `2b582ff`). All three Inngest functions registered. Failure alert row + stalled alert row confirmed in DB. Resend pipeline delivers (returns message id). One user action blocks the email milestone: Resend free tier restricts sender to verified domain only.
- **In progress:** Nothing. Phase 4 code fully done.
- **Next task:** Phase 5 — Monetization. Tasks: (1) Stripe Checkout + Billing Portal (hosted), (2) `/api/stripe/webhook` → `subscriptions` table, (3) plan gating + usage-vs-quota display in settings. **Milestone: charge real money.**
- **Open decisions / blocked items:**
  - **Resend email delivery**: Resend account owner is `akshatagrawal.work@gmail.com` but AutoWatch org owner in DB is `agrawalakshat.coc@gmail.com`. Free tier + default `onboarding@resend.dev` sender only delivers to the account owner email → alert emails 403 (caught as non-fatal, so alert ROWS are created but email doesn't reach inbox). **Resolution chosen: verify a domain at resend.com/domains, then set `RESEND_FROM_EMAIL=AutoWatch Alerts <alerts@yourdomain.com>` in Vercel + redeploy.** Code already reads that env var with `onboarding@resend.dev` fallback (`lib/resend.ts`). No code change needed — just DNS + one Vercel env var.
- **Errors in flight:** None. `npm run lint && npm run typecheck` clean.
- **Key decisions / facts to remember:**
  - Supabase project: `sucgnzxpljvkplcgvvyu`, region `ap-south-1`, free tier
  - Vercel project: `autowatch` → `https://autowatch.vercel.app`, linked to `akshat333-debug/AutoWatch` on GitHub, auto-deploy on push to `main`
  - Vercel project ID: `prj_uGFevaICkTB1ZNH22rVSVhM6B1t4`, team ID: `team_onpE0A5yfGkttI83BVeodE0B`
  - Sentry org: `akshat-qv`, project: `autowatch`, DSN set in Vercel + `.env.local`
  - Inngest app: `autowatch` on app.inngest.com; synced endpoint: `https://autowatch.vercel.app/api/inngest`; registered functions: `summarize-event`, `alert-on-failure`, `check-stalled`
  - All Vercel production env vars set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `ANTHROPIC_API_KEY` (unused), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`
  - Test endpoint: `endpoint_key=3e58993a94ee5109a1d1a9cb9e2d97231aa42f0893c69f76033514ec08c3b6c6`, `signing_secret=8f5adf5213924273d1599503ad6313f2da5283eb2e2091b8567557fc38caad2f`, label="Zapier - CRM sync", `expected_interval_seconds=3600`, org_id=`3ed3fd6c-bc34-4234-afbf-5ebc0dd713fa`
  - Auth: magic-link only (no password). `ensureOrgForUser` runs in `/auth/callback` — idempotent org + `org_members` creation via service-role client
  - Dashboard route group: `app/(dashboard)/` — layout double-checks auth server-side even though middleware also guards it
  - `lib/supabase-server.ts` = RLS-scoped (user JWT); `lib/supabase-admin.ts` = service-role (bypasses RLS, server-only)
  - Inngest v4 API: triggers go inside options object as `triggers: [{ event: "..." }]` — NOT a 3-arg createFunction call (v3 style breaks in v4)
  - **LLM provider: Gemini** (`@google/genai` v2.8.0). `lib/gemini.ts`: `MODEL_SUMMARY = "gemini-3.1-flash-lite"` (per-event; free tier 15 RPM / 500 RPD), `MODEL_DIGEST = "gemini-3.5-flash"` (Phase 6). `lib/anthropic.ts` left dormant as fallback.
  - Ingest route enqueues via `next/server` `after(async () => inngest.send(...))` — NOT bare `void promise`
  - To re-register Inngest after a redeploy: `curl -X PUT https://autowatch.vercel.app/api/inngest` → `{"message":"Successfully registered","modified":true}`
  - Resend: `lib/resend.ts` exports `sendAlertEmail()` + `getOrgOwnerEmail()`. Email is best-effort (non-fatal catch). Reads `RESEND_FROM_EMAIL` env var; falls back to `onboarding@resend.dev`.
  - Alert dedup: stalled alerts — one unresolved per endpoint at a time (checked before insert). Failure alerts — one per error event (no dedup, by design for MVP).
  - `app/actions/alerts.ts` — `resolveAlert(alertId)` server action, RLS-scoped, calls `revalidatePath("/dashboard/alerts")`
- **Phase history:**
  - Phase 0 ✅ — schema + RLS + Vercel deploy
  - Phase 1 ✅ — magic-link auth + dashboard shell
  - Phase 2 ✅ — endpoints create flow + HMAC ingest + event timeline (commits `b4efeef`, `7e805f0`, `bbaa40d`, `bff80f3`)
  - Phase 3 ✅ — Inngest summarization pipeline; `after()` fix (`170d1f4`); Gemini switch (`bcb55f0`); milestone verified (`07dfd0a`)
  - Phase 4 ✅ — Alerting: failure detection, stalled cron, alerts inbox UI, Resend email (commit `2b582ff`); milestone ⏳ pending Resend domain verification

After compact:
Read CLAUDE.md fully, especially this snapshot. Tell me what we were doing and what you're picking up next.