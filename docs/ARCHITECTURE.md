# ARCHITECTURE

## High-level system

```
            ┌─────────────────────────────────────────────┐
 Zapier ─┐  │  Vercel / Next.js 15 (App Router)            │
 Make  ──┤  │                                              │
 n8n   ──┼─▶│  /api/ingest/[key]   (HMAC verify, rate-     │
 Custom ─┘  │   limit, quota, insert raw event, 202)       │
            │        │ enqueue                              │
            │        ▼                                      │
            │  Inngest functions (durable, retries):       │
            │   • summarize (Haiku 4.5)                     │
            │   • anomaly/failure/stalled check            │
            │   • daily digest (Sonnet 4.6, batch)         │
            │        │            │            │            │
            │        ▼            ▼            ▼            │
            │   Anthropic API   Resend      (reads DB)      │
            │                                              │
            │  /api/stripe/webhook  ─▶ subscriptions       │
            │  (dashboard UI: events, alerts, billing)     │
            └───────────────┬──────────────────────────────┘
                            │ RLS-scoped reads / service-role writes
                            ▼
                  ┌───────────────────────────┐
                  │ Supabase (Postgres + Auth)│
                  │ orgs, org_members,         │
                  │ endpoints, events,         │
                  │ summaries, alerts,         │
                  │ subscriptions  (+ RLS)     │
                  └───────────────────────────┘
```

## Data flow — one event

1. User's automation sends a **signed** `POST /api/ingest/[endpointKey]` with `X-Signature: sha256=HMAC(secret, body)`.
2. Ingest route: verify signature → resolve endpoint → org → check `is_active` + quota → insert into `events (status='pending')` (idempotent on `dedup_key`) → enqueue Inngest `event/ingested` → return `202` fast. **No LLM call here.**
3. `summarize` worker: load event → Haiku 4.5 with cached system prompt → store plain-English `summaries` row + extracted structured fields on `events` → set `status='summarized'` → emit `event/summarized`.
4. `anomaly` worker (per-event cheap rules + scheduled statistical check): evaluate failure/stalled/volume → write `alerts` row + send alert email via Resend if flagged.
5. `digest` worker (daily cron, per org): aggregate the day's summaries + open alerts → Sonnet 4.6 narrative (Batch API) → Resend email.

## Components & responsibilities

| Component | Responsibility | Notes |
|---|---|---|
| Ingestion route | Auth (HMAC), tenancy resolution, quota, persist, enqueue | Stateless, fast, idempotent. Returns 202. |
| `summarize` (Inngest) | Raw payload → 1 sentence + structured fields | Haiku 4.5, prompt caching, retries. |
| `anomaly` (Inngest) | Failure/stalled/volume detection → alerts | Rules-first, statistics-later. |
| `digest` (Inngest cron) | Daily narrative email | Sonnet 4.6 + Batch API. |
| Dashboard (Next.js) | Timeline, detail, alerts inbox, settings, billing | shadcn/ui; RLS-scoped reads. |
| Billing | Stripe Checkout + Portal + webhook → `subscriptions` | Quota read from `orgs`. |
| Export | Date-ranged PDF | pdf-lib; Pro feature. |

## Multi-tenancy

- Tenant boundary = **org**. A user belongs to an org via `org_members` (MVP: one org per user, role `owner`).
- **Row-Level Security on every table**, keyed by `org_id` via membership lookup.
- Dashboard uses the user-JWT (RLS-scoped) Supabase client. Background jobs use the service-role client (bypasses RLS) and **must set `org_id` explicitly** on every query.

## Anomaly detection design (do this, not naive z-score)

Ship in this order — earlier rules have the best signal-to-noise:

1. **Stalled** *(ship first)* — an endpoint that normally fires on a regular cadence has had 0 events for > 2× its typical interval. Highest value, lowest false positives.
2. **Failure spike** — events whose payload indicates an error/failed status exceed ~3× the rolling failure baseline in a window (and count > a small floor).
3. **Volume anomaly** *(later)* — compare the window's count to the **median** of the same weekday/hour over the trailing 4 weeks using **MAD** (median absolute deviation): flag if `|count − median| > 3 × 1.4826 × MAD` **and** `median ≥ 5` (minimum baseline to avoid firing on tiny N).

Never use mean/stddev z-score on low-volume bursty SMB traffic — it produces constant false positives and causes alert-fatigue churn.

## Cost architecture

- Per-event: **Haiku 4.5** ($1/$5 per MTok) with cached system prompt → roughly ~$0.0015/event.
- Daily digest: **Sonnet 4.6** ($3/$15) via **Batch API** (50% off) — not latency sensitive.
- Quota enforced at the ingestion edge caps both abuse and LLM spend.

## Scalability notes (MVP-appropriate, not premature)

- Index `events(org_id, occurred_at desc)`; paginate the timeline.
- Inngest handles retry/backpressure for the LLM pipeline.
- Retention purge job deletes raw payloads past the plan window (keeps DB small; reduces PII liability).
- Defer ClickHouse/dedicated analytics until volume genuinely demands it.

## Third-party integrations

Anthropic (summaries/digest), Stripe (billing), Resend (email), Supabase (DB/auth), Inngest (jobs), Sentry (errors), Vercel (host). Inbound: Zapier/Make/n8n/custom via signed webhooks.
