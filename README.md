# AutoWatch ⚡

**Know what your automations did — and get alerted the moment one breaks or goes rogue, in plain English.**

Small businesses run on no-code automations (Zapier, Make, n8n) wiring together their CRM, email, and billing. When one silently breaks or fires abnormally — emails 400 contacts instead of 40 — the owner finds out from an angry customer, not a dashboard. AutoWatch is the cross-platform, plain-English monitor that catches it first.

**Live:** [autowatch.vercel.app](https://autowatch.vercel.app)

---

## What it does

- **Signed webhook ingestion** — one HMAC-verified endpoint per automation; rate-limited, quota-enforced, returns `202` and enqueues async.
- **Plain-English summaries** — every event summarized by Claude Haiku so a non-technical owner understands what happened.
- **Failure & stalled detection** — alerts when an automation reports an error, or when one that normally fires goes quiet (highest-signal, lowest-false-positive).
- **Daily digest** — batched summary email (Claude Sonnet).
- **Compliance PDF export** — date-ranged event log for audit-conscious businesses.
- **Billing** — Stripe subscriptions with per-plan quotas; magic-link auth; multi-tenant orgs.

## Architecture

```
Zapier / Make / n8n / custom
        │  HMAC-signed webhook
        ▼
/api/ingest/[key]  →  verify · rate-limit · quota · insert · 202
        │ enqueue
        ▼
Inngest durable functions (retries):
  • summarize (Claude Haiku)     • failure / stalled / anomaly checks
  • daily digest (Claude Sonnet) • retention purge
        │
        ▼
Supabase (Postgres + RLS)  ·  Resend (email)  ·  Stripe (billing)  ·  Sentry
```

## Stack

Next.js 15 (App Router) · TypeScript · Supabase (Postgres, RLS, magic-link auth) · Inngest (durable background jobs) · Anthropic (Haiku + Sonnet) · Stripe · Resend · Sentry · Tailwind + shadcn/ui · Zod

## Status

MVP live. Signed ingestion, summarization, failure/stalled alerts, daily digest, Stripe billing, and PDF export are implemented. See [`docs/`](docs/) for the full PRD, architecture, schema, and security model.

## License

MIT
