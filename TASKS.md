# TASKS

Build in phase order. Don't skip Phase 0. Update status as you go: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.

**Current phase:** 5

---

## Phase 0 — Foundations

- [x] Create Next.js 15 + TS app, Tailwind, shadcn/ui init
  - Next.js 15.5.19, React 19, strict TS, Tailwind v4, shadcn neutral theme
  - Sentry wired via `withSentryConfig`; PII scrubbed in `beforeSend`
  - All project deps installed; `typecheck` + `lint` scripts pass clean
- [x] Create Supabase project; add `.env.local` from `.env.example`
  - Project: AutoWatch (sucgnzxpljvkplcgvvyu), region ap-south-1, free tier
  - .env.local has URL + anon key; SUPABASE_SERVICE_ROLE_KEY needs manual fill from dashboard
- [x] Apply schema + RLS from `docs/SCHEMA.md`
  - All 7 tables created, RLS enabled on all, 7 policies applied via MCP
  - Real generated types written to lib/database.types.ts
- [x] GitHub → Vercel auto-deploy; separate prod/preview env vars
  - Project: autowatch on Vercel, linked to akshat333-debug/AutoWatch
  - Prod env vars set: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
  - Live at https://autowatch.vercel.app; auto-deploys on push to main

## Phase 1 — Auth + dashboard shell

- [x] Supabase magic-link auth (`@supabase/ssr` server client)
  - middleware.ts: protects /dashboard, redirects unauthenticated → /login
  - /login page + server action (signInWithOtp → redirect on sent/error)
  - /auth/callback: exchanges code, sets session cookies
  - ⚠️ Manual step: add redirect URLs in Supabase Auth dashboard
- [x] Org creation on first login + `org_members` row (server action)
  - lib/ensure-org.ts: idempotent — checks org_members before inserting
  - Called from /auth/callback after session established
- [x] Protected dashboard layout with shadcn sidebar, empty states
  - DashboardNav with Activity / Alerts / Endpoints links + sign-out
  - /dashboard page with empty state
- [ ] **Milestone: I can log in and see an empty dashboard**

## Phase 2 — Secure ingestion

- [x] `endpoints` create flow (generate `endpoint_key` + `signing_secret`, show secret once)
  - Server action: Zod-validated, RLS-scoped INSERT, crypto.randomBytes(32) for both keys
  - Client form: useActionState, one-time secret reveal panel with copy buttons
  - List page: SELECT excludes signing_secret; router.refresh() on Done
- [x] `POST /api/ingest/[key]` with HMAC verify (`lib/hmac.ts`, raw body, constant-time compare)
  - lib/hmac.ts: verifyHmacSignature with timingSafeEqual; rejects bad length before compare
  - Route: raw body buffered first, endpoint lookup, HMAC verify, quota check, idempotent insert
  - 401/404/429/202 per spec; never logs or echoes payload (PII); dedup_key + is_error extracted
  - TODO(phase3): Inngest enqueue stub left in place
- [x] Idempotency on `dedup_key`; quota check → `429`; always return `202`
  - Covered in route above: catches 23505 for duplicate dedup_key (→ 202), quota count query, 429 on exceed
- [x] Event timeline (raw events) in dashboard
  - /dashboard page: fetches events (+ endpoints join + summaries join) ordered by occurred_at desc
  - Shows endpoint badge, error badge, description (summary text when available, structured fields, or "Pending…")
  - Server-side relative timestamps; empty state links to /dashboard/endpoints
  - summaries join included now — Phase 3 just inserts rows, no UI change needed
- [x] **Milestone: a signed event lands and shows up**

## Phase 3 — Summarization

- [x] Inngest setup + `/api/inngest` route; register `summarize` function
  - lib/inngest/client.ts: singleton Inngest client (id: "autowatch")
  - app/api/inngest/route.ts: serve() handler exporting GET/POST/PUT
- [x] `summarize` Inngest function (Gemini Flash-Lite, structured JSON, retries)
  - lib/inngest/summarize.ts: retries: 3, triggers: [{ event: "event/ingested" }]
  - lib/gemini.ts: server-only @google/genai client; MODEL_SUMMARY = gemini-3.1-flash-lite
  - responseMimeType: "application/json" → guaranteed valid JSON output
  - System prompt requests: summary, action_type, object_type, object_count, target_system
  - Provider switched from Anthropic→Gemini 2026-06-07 (Anthropic acct had no credit; Gemini free tier 500 RPD on Flash-Lite). lib/anthropic.ts kept dormant.
- [x] Store summary + extracted structured fields; flip event `status → summarized`
  - Idempotency: skips if status === "summarized"; handles 23505 on summaries insert
  - JSON parse fallback: raw text used as summary if LLM returns non-JSON
  - Ingest route enqueues via next/server after() (bare void promise was killed post-202)
- [x] Show plain-English summaries in timeline + event detail drawer
  - Dashboard joins summaries; verified live with test-phase3-005
- [x] **Milestone: "Your CRM zap updated 47 contacts" on screen**
  - Verified end-to-end 2026-06-07: signed webhook → Gemini → "Updated 47 contacts in HubSpot"
    + structured fields (updated/contact/47/HubSpot), status=summarized, model=gemini-3.1-flash-lite

## Phase 4 — Alerting

- [x] Stalled detection Inngest cron + alert email via Resend
  - lib/inngest/check-stalled.ts: 5-min cron; checks endpoints with expected_interval_seconds
  - Dedup: one unresolved "stalled" alert per endpoint at a time
  - lib/resend.ts: Resend client + sendAlertEmail() + getOrgOwnerEmail()
- [x] Failure detection from `is_error` signal on ingest
  - lib/inngest/alert-on-failure.ts: triggered by event/ingested, checks is_error
  - Inserts alert row + emails org owner (best-effort, non-fatal)
- [x] Alerts inbox UI + resolve action
  - app/(dashboard)/dashboard/alerts/page.tsx: open/resolved sections, kind/severity badges
  - app/actions/alerts.ts: resolveAlert server action (RLS-scoped, revalidates)
- [~] **Milestone: I get emailed when an automation breaks/stalls**
  - ✅ Verified end-to-end 2026-06-07:
    - Signed failure webhook (error:true) → `failure`/warning alert row created by alert-on-failure
    - check-stalled cron → `stalled`/critical alert row (endpoint silent > expected_interval_seconds=3600)
    - Resend pipeline confirmed: API returns message id, delivers to account-owner address
    - RESEND_API_KEY set in Vercel; Inngest re-registered (summarize + alert-on-failure + check-stalled)
  - ⏳ BLOCKED on email delivery to org owner: Resend free tier + default onboarding@resend.dev
    sender only delivers to the Resend ACCOUNT owner (akshatagrawal.work@gmail.com), but the
    AutoWatch org owner is agrawalakshat.coc@gmail.com → in-app alert emails 403 (caught, non-fatal).
  - 👉 RESOLUTION CHOSEN: verify a domain at resend.com/domains (user DNS action), then set
    RESEND_FROM_EMAIL=AutoWatch Alerts <alerts@yourdomain.com> in Vercel + redeploy.
    Code already reads RESEND_FROM_EMAIL (lib/resend.ts) with onboarding@resend.dev fallback.

## Phase 5 — Monetization

- [x] Stripe Checkout + Billing Portal (hosted, no custom UI)
  - lib/stripe.ts: singleton, PLANS constants (free 500 / starter 5k / pro 50k), getPriceId, planFromPriceId
  - app/actions/billing.ts: createCheckoutSession + createBillingPortalSession server actions
- [x] `/api/stripe/webhook` (raw body, signature, idempotent) → `subscriptions` + plan/quota
  - Handles checkout.session.completed, subscription.updated/deleted, invoice.payment_failed
  - upserts subscriptions table + updates orgs.plan + orgs.monthly_event_quota
  - Compatible with Stripe API 2026-05-27.dahlia (billing_schedules[0].bill_until.computed_timestamp)
- [x] Plan gating + usage-vs-quota display in settings
  - app/(dashboard)/dashboard/settings/page.tsx: usage bar, upgrade cards, billing portal link
  - Settings link added to DashboardNav
- [~] **Milestone: I can charge real money**
  - ⏳ BLOCKED on Stripe keys: add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_STARTER_PRICE_ID,
    STRIPE_PRO_PRICE_ID to Vercel env vars (and .env.local for local testing), then redeploy.
  - Local webhook testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
  - Commit: be23ec6

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
