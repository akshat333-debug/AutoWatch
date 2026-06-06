# TASKS

Build in phase order. Don't skip Phase 0. Update status as you go: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.

**Current phase:** 0

---

## Phase 0 — Foundations

- [x] Create Next.js 15 + TS app, Tailwind, shadcn/ui init
  - Next.js 15.5.19, React 19, strict TS, Tailwind v4, shadcn neutral theme
  - Sentry wired via `withSentryConfig`; PII scrubbed in `beforeSend`
  - All project deps installed; `typecheck` + `lint` scripts pass clean
- [ ] Create Supabase project; add `.env.local` from `.env.example`
- [ ] Apply schema + RLS from `docs/SCHEMA.md`
  - Write migration SQL into `supabase/migrations/0001_init.sql`
  - `npx supabase db push`; verify all 7 tables + RLS policies exist
- [ ] GitHub → Vercel auto-deploy; separate prod/preview env vars

## Phase 1 — Auth + dashboard shell

- [ ] Supabase magic-link auth (`@supabase/ssr` server client)
- [ ] Org creation on first login + `org_members` row (server action)
- [ ] Protected dashboard layout with shadcn sidebar, empty states
- [ ] **Milestone: I can log in and see an empty dashboard**

## Phase 2 — Secure ingestion

- [ ] `endpoints` create flow (generate `endpoint_key` + `signing_secret`, show secret once)
- [ ] `POST /api/ingest/[key]` with HMAC verify (`lib/hmac.ts`, raw body, constant-time compare)
- [ ] Idempotency on `dedup_key`; quota check → `429`; always return `202`
- [ ] Event timeline (raw events) in dashboard
- [ ] **Milestone: a signed event lands and shows up**

## Phase 3 — Summarization

- [ ] Inngest setup + `/api/inngest` route; register `summarize` function
- [ ] `summarize` Inngest function (Haiku 4.5, cached system prompt, retries)
- [ ] Store summary + extracted structured fields; flip event `status → summarized`
- [ ] Show plain-English summaries in timeline + event detail drawer
- [ ] **Milestone: "Your CRM zap updated 47 contacts" on screen**

## Phase 4 — Alerting

- [ ] Stalled detection Inngest cron + alert email via Resend
- [ ] Failure detection from `is_error` signal on ingest
- [ ] Alerts inbox UI + resolve action
- [ ] **Milestone: I get emailed when an automation breaks/stalls**

## Phase 5 — Monetization

- [ ] Stripe Checkout + Billing Portal (hosted, no custom UI)
- [ ] `/api/stripe/webhook` (raw body, signature, idempotent) → `subscriptions` + plan/quota
- [ ] Plan gating + usage-vs-quota display in settings
- [ ] **Milestone: I can charge real money**

## Phase 6 — Digest + export

- [ ] Daily digest Inngest cron (Sonnet 4.6, Batch API) → Resend
- [ ] Retention purge cron (delete raw payloads past `retention_days`)
- [ ] PDF export (pdf-lib), Pro-gated
- [ ] **Milestone: digest arrives; export works**

## Phase 7 — Polish

- [ ] Onboarding flow with "waiting for first event" live state
- [ ] Per-platform setup guides (Zapier / Make / n8n signing instructions)
- [ ] Search/filter events, mobile pass
- [ ] Volume anomaly (MAD-based, min baseline) — optional

## Phase 8 — Distribution (run in parallel from day 1)

- [ ] Landing page + waitlist
- [ ] Start Zapier app / Make module submission (slow approval)
- [ ] Build-in-public posts; collect interested SMBs
- [ ] Launch posts (r/smallbusiness, r/automation, Indie Hackers, Product Hunt)
- [ ] **Milestone: first paying customer** (~week 8–10)

---

## Blockers

(none)

## Notes

- See `ERRORS.md` before retrying anything that failed before.
- Scope = instrumented automations only. No "every AI tool" claims.
- Docs are complete: PRD, ARCHITECTURE, DESIGN, API, SCHEMA, SECURITY, ERRORS all written.
