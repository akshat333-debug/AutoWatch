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

- **Last completed task:** Phase 1 complete — auth + dashboard shell (commit `dc88ce1`). Sentry auth token added to Vercel after that commit (no code change, env-only).
- **In progress:** Nothing. Phase 1 milestone pending manual verification (user needs to log in and confirm dashboard loads).
- **Next task:** Phase 2, Task 1 — `endpoints` create flow: generate `endpoint_key` + `signing_secret` (crypto.randomBytes), store in DB, show secret once on creation.
- **Open decisions:** None blocking. Phase 1 milestone (`I can log in and see an empty dashboard`) has not been explicitly confirmed by user — assume it works unless they report otherwise.
- **Errors in flight:** None. `npm run lint && npm run typecheck` passes clean.
- **Key decisions made this session:**
  - Supabase project: `sucgnzxpljvkplcgvvyu`, region `ap-south-1`, free tier
  - Vercel project: `autowatch` → `https://autowatch.vercel.app`, linked to `akshat333-debug/AutoWatch` on GitHub, auto-deploy on push to `main`
  - Sentry org: `akshat-qv`, project: `autowatch`, DSN set in Vercel + `.env.local`
  - All Vercel production env vars set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
  - Auth: magic-link only (no password). `ensureOrgForUser` runs in `/auth/callback` — idempotent org + `org_members` creation via service-role client
  - Server action pattern: server actions return `void` and use `redirect()` for both success and error paths (no `useActionState` needed for login)
  - Dashboard route group: `app/(dashboard)/` — layout double-checks auth server-side even though middleware also guards it
  - `lib/supabase-server.ts` = RLS-scoped (user JWT); `lib/supabase-admin.ts` = service-role (bypasses RLS, server-only)

After compact:
Read CLAUDE.md fully, especially this snapshot. Tell me what we were doing and what you're picking up next.