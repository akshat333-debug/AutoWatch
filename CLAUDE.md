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
- **Anthropic SDK** — `claude-haiku-4-5` for per-event summaries, `claude-sonnet-4-6` for daily digests
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
  anthropic.ts            # model wrappers + prompt-cache config
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
3. **Never** call the LLM per event with Sonnet/Opus by default — use Haiku 4.5 for per-event work (cost). Sonnet 4.6 only for the daily digest, ideally via the Batch API.
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

- **Last completed task:** Phase 3, Tasks 1–3 — Inngest + Haiku summarization pipeline (commit `47ecee1`). Inngest app created on app.inngest.com (app: `autowatch`), synced to `https://autowatch.vercel.app/api/inngest`. All three keys (`ANTHROPIC_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) added to Vercel env vars (Production + Preview) and `.env.local`. Vercel redeployed manually — latest deployment `dpl_ALWfU56dpqYMVtyYAgn9pviNEvms` is READY.
- **In progress:** Nothing.
- **Next task:** Phase 3, Task 4 — verify Phase 3 milestone end-to-end: send a signed test webhook → confirm "Your CRM zap updated 47 contacts" (or similar) appears in the dashboard timeline. Dashboard UI already joins summaries — just needs a real event to flow through the pipeline.
- **Open decisions:** None blocking. Phase 3 milestone (`"Your CRM zap updated 47 contacts" on screen`) not yet manually verified — send a test event to confirm.
- **Errors in flight:** None. `npm run lint && npm run typecheck` passes clean.
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
  - `lib/anthropic.ts`: `MODEL_SUMMARY = "claude-haiku-4-5"`, `MODEL_DIGEST = "claude-sonnet-4-6"` — hard rule, never swap these
  - `.mcp.json` added to project root: `inngest-dev` MCP server (curl → localhost:8288/mcp); `.claude/settings.json` auto-approves it
  - Inngest `summarize` function: idempotency on `status === "summarized"` + 23505 on summaries insert; JSON parse fallback; explicit `org_id` on all service-role queries; non-blocking `inngest.send()` in ingest route (fire-and-forget with `.catch()`)
- **Phase history:**
  - Phase 0 ✅ — schema + RLS + Vercel deploy
  - Phase 1 ✅ — magic-link auth + dashboard shell
  - Phase 2 ✅ — endpoints create flow + HMAC ingest + event timeline (commits `b4efeef`, `7e805f0`, `bbaa40d`, `bff80f3`)
  - Phase 3 ✅ (code) — Inngest + Haiku summarization (commit `47ecee1`); milestone verification pending

After compact:
Read CLAUDE.md fully, especially this snapshot. Tell me what we were doing and what you're picking up next.