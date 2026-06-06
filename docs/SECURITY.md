# SECURITY

This is a trust product that holds customers' business data. Security is a feature, not an afterthought.

## Auth strategy

- **User auth:** Supabase Auth, magic-link (passwordless) for MVP; optionally Google OAuth later. Sessions via Supabase SSR helpers.
- **Tenant model:** org-scoped. `org_members` maps users to orgs with a `role` (MVP: `owner`). All authorization derives from membership.

## Ingestion authentication (critical)

- The endpoint URL contains a random `endpoint_key`, but **the key alone is never sufficient**.
- Every request must carry `X-Signature: sha256=<hex>`, an HMAC-SHA256 of the **raw request body** using the endpoint's `signing_secret`.
- Verify with a **constant-time** comparison. Reject mismatches with `401`.
- Provide a "rotate secret" action; invalidate the old secret immediately on rotate.
- This prevents forged/injected audit events — a forged log entry would defeat the product's entire purpose.

## Row-Level Security

- RLS enabled on **every** table, keyed by `org_id` via `org_members` lookup.
- Dashboard reads use the **user-JWT** Supabase client (RLS enforced).
- Background jobs + Stripe webhook use the **service-role** client (bypasses RLS) and MUST set `org_id` explicitly on every query. Treat service-role code paths as privileged and review them carefully.
- **Test cross-tenant isolation before launch:** create two orgs, authenticate as one, attempt to read the other's events/alerts/endpoints, and confirm denial.

## Sensitive data handling

- `events.raw_payload` may contain customer PII (contact info, email contents, invoice data). Treat it as sensitive at all times.
- **Never** send raw payloads to Sentry, logs, analytics, or any third party. Scrub before any external transmission.
- Offer field redaction on ingest (configurable per endpoint) for known-sensitive keys.
- **Retention:** auto-purge `raw_payload` (and optionally whole events) past the plan's `retention_days`. Derived summaries may be kept longer if useful, but document this. Less retained data = less liability and smaller breach surface.

## Secrets

| Variable | Scope |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server only — never import into client components. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Server only. |
| `ANTHROPIC_API_KEY` | Server only. |
| `RESEND_API_KEY`, `INNGEST_*` | Server only. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (RLS protects data). |

Use `import "server-only"` to fence server modules. Keep production and preview secrets separate in Vercel.

## What should never be logged or exposed

- Raw event payloads, signing secrets, service-role key, Stripe keys, any auth token.
- Error messages returned to clients must not echo payload contents.

## Webhook integrity (Stripe)

- Verify `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET`. Reject unverified. Make handlers idempotent (Stripe retries).

## Roadmap (when customers ask)

- DPA / privacy policy before selling to compliance-minded buyers.
- Consider SOC 2 readiness only once there's real demand — don't pre-optimize.
- Do **not** market EU AI Act compliance guarantees; position the export as "audit-ready records," not legal compliance certification.
