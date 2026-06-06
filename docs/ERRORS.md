# ERRORS — Known Issues, Constraints & Anti-Patterns

Living file. When Claude Code hits an error and finds a fix, record it here so it isn't repeated.

## Anti-patterns already decided against (do NOT reintroduce)

- ❌ **Trusting the ingest URL path alone.** Always HMAC-verify. (See SECURITY.md.)
- ❌ **Calling the LLM inline in the ingest route.** Causes timeouts and slow responses to Zapier/Make. Always enqueue Inngest.
- ❌ **Sonnet/Opus per event.** Use Haiku 4.5 per event; Sonnet 4.6 only for digests.
- ❌ **Mean/stddev z-score anomaly detection.** Use stalled + failure rules first, then MAD with a minimum baseline.
- ❌ **Bypassing RLS client-side to "make a query work."** Fix the policy instead.
- ❌ **Logging raw payloads to Sentry/console in prod.** PII leak.
- ❌ **Marketing copy claiming "every AI tool" or EU AI Act compliance certification.**

## Known platform quirks to watch for

- **Vercel function timeouts:** keep request handlers fast; long work goes to Inngest. Verify the `/api/inngest` route is registered after each deploy.
- **Stripe webhooks:** must read the **raw** request body for signature verification — Next.js route handlers need the raw body, not parsed JSON. Make handlers idempotent (Stripe retries).
- **HMAC verification:** sign/verify against the **exact raw bytes** of the body. Parsing then re-stringifying JSON will change bytes and break the signature.
- **Supabase service-role client:** bypasses RLS — every query in those code paths must set `org_id` explicitly, or you risk cross-tenant writes.
- **Resend:** must verify the sending domain before deliverability is reliable; the free tier has monthly caps.
- **Inngest local dev:** run the Inngest dev server alongside `npm run dev` so functions are discoverable locally.

## Open questions / decisions pending

- How users compute HMAC inside Zapier without a native app (Code step vs. documented helper) — resolve in onboarding before launch.
- Exact `expected_interval_seconds` inference for stalled detection (user-set vs. auto-learned).
- Retention defaults per plan (currently 7/30/365) — revisit with first users.

## Error log (append as encountered)

```
[date] — symptom — root cause — fix
(none yet)
```
