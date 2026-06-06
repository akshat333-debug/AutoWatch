# API Reference

## Inbound webhook (the core ingestion API)

### `POST /api/ingest/[endpointKey]`
Receives an event from a user's automation.

- **Auth:** HMAC. Header `X-Signature: sha256=<hex>` where `<hex> = HMAC_SHA256(signing_secret, rawRequestBody)`. Verified with a constant-time compare against the endpoint's `signing_secret`. Reject unsigned/invalid with `401`.
- **Body:** arbitrary JSON (the automation's payload). We extract `dedup_key` from `payload.id`/`payload.event_id` if present.
- **Behavior:** verify → resolve `endpointKey` → org → check `is_active` + monthly quota → insert `events(status='pending')` (idempotent on `dedup_key`) → enqueue Inngest `event/ingested` → return immediately.
- **Responses:**
  - `202 Accepted` — stored (or already stored, idempotent).
  - `401` — bad/missing signature.
  - `404` — unknown or inactive endpoint key.
  - `429` — monthly event quota exceeded for the plan.
  - `500` — server error (source platform may retry; ingestion is idempotent).

**How users configure it (Zapier example):** add a "Webhooks by Zapier → POST" step pointing at the endpoint URL, with a Code step computing the HMAC, or use our (post-MVP) native Zapier app that signs automatically. Document this clearly in onboarding.

## Internal app API (dashboard, RLS-scoped)

Prefer Server Components / server actions reading via the RLS-scoped Supabase client. Where REST routes are needed:

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/events` | Paginated event + summary list (filter by endpoint, date, error) | User session |
| GET | `/api/events/[id]` | Single event detail | User session |
| GET | `/api/alerts` | Open/recent alerts | User session |
| POST | `/api/alerts/[id]/resolve` | Mark alert resolved | User session |
| POST | `/api/endpoints` | Create endpoint (returns key + secret once) | User session |
| POST | `/api/endpoints/[id]/rotate` | Rotate signing secret | User session |
| GET | `/api/export?from=&to=` | Generate compliance PDF (Pro) | User session |
| POST | `/api/billing/checkout` | Create Stripe Checkout session | User session |
| POST | `/api/billing/portal` | Create Billing Portal session | User session |

**Error format (internal):** `{ "error": { "code": string, "message": string } }` with appropriate HTTP status. Never include raw payload contents in error messages.

## Stripe webhook

### `POST /api/stripe/webhook`
- **Auth:** verify `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`.
- **Handles:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- **Effect:** upsert `subscriptions`, update `orgs.plan` + `orgs.monthly_event_quota` + `orgs.retention_days`. Must be idempotent.

## Inngest events (internal job bus)

| Event | Emitted by | Consumed by |
|---|---|---|
| `event/ingested` | ingest route | `summarize` |
| `event/summarized` | `summarize` | `anomaly` |
| `cron/daily-digest` | scheduler | `digest` |
| `cron/anomaly-scan` | scheduler | `anomaly` (statistical) |
| `cron/retention-purge` | scheduler | retention purge |

## External APIs consumed

| Service | Use | Notes / limits |
|---|---|---|
| Anthropic Messages API | `claude-haiku-4-5` per-event; `claude-sonnet-4-6` digest | Prompt caching on system prompt; Batch API (50% off) for digests. |
| Stripe | Checkout, Billing Portal, subscriptions | Test with `stripe listen`. |
| Resend | Alert + digest emails | Free up to ~3k emails/mo; verify sending domain. |
| Supabase | Auth + Postgres | Service-role key server-only. |

## Rate limits & quotas

- Per-plan monthly event quota enforced at ingestion (`429` on exceed).
- Consider a per-endpoint burst limit to absorb misconfigured automations without blowing the LLM budget.
