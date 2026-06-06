# PRD — Product Requirements

## Problem statement

Small businesses increasingly run their operations on no-code automations (Zapier, Make, n8n) that move data between their CRM, email, billing, and other tools. When one of these automations silently breaks, stalls, or fires abnormally (e.g. emails 400 contacts instead of 40), the owner often doesn't find out until a customer complains or revenue is lost. The native run histories in those platforms are per-tool, ugly, and require knowing where to look. There is no simple, cross-platform, plain-English place that tells a non-technical owner *what their automations did and whether anything went wrong.*

## Target users (ICP)

- **Primary:** non-technical owner/operator of a small business (roughly 1–50 people) who relies on 3–20 no-code automations and would lose money or face embarrassment if one broke silently.
- **Sharper wedge:** regulated-adjacent small businesses (healthcare-adjacent, fintech-adjacent, agencies handling client data, EU-facing) who already feel some audit/record-keeping pressure and will value the export.
- **Not the ICP:** engineering teams building AI agents (served by Langfuse/LangSmith/Braintrust); enterprises needing infra observability (Datadog/New Relic).

## Value proposition

> "Know what your automations did, and get alerted the moment one breaks or goes rogue — in plain English, across all your tools, no engineer required."

Lead with reliability/alerting (painkiller). Logging and compliance export are supporting features, not the headline.

## Core features

### Must-have (MVP)
- Signed webhook ingestion endpoints (one per automation the user wires up).
- Per-event plain-English summary.
- Event timeline + per-event detail + search/filter.
- **Failure detection** (automation reported an error) → alert.
- **Stalled detection** (an automation that normally fires has gone quiet) → alert. *(Highest-signal, lowest-false-positive alert — ship first.)*
- Daily digest email.
- Auth (magic link), org/account, settings, billing (Stripe), per-plan quotas.

### Nice-to-have (post-MVP)
- Volume/anomaly detection (MAD-based, with minimum baseline).
- Compliance PDF export (date-ranged log).
- Multi-user orgs / roles.
- Native Zapier app / Make module so users don't hand-build webhook steps.

### Explicitly later / maybe never
- True state diffs (before/after) requiring per-CRM OAuth integrations.
- Capture of AI tools that don't emit instrumentable webhooks.

## User stories

- As an owner, I wire my Zapier zap to AutoWatch in under 5 minutes and immediately see its activity in plain English.
- As an owner, I get an email within minutes when an automation errors or stops running, so I can fix it before a customer notices.
- As an owner, I open a daily digest each morning that tells me what ran and whether anything needs attention.
- As a compliance-minded owner, I export a clean PDF of all automation activity for a date range when asked.

## Success metrics

- **Activation:** % of signups that successfully ingest a real event within 24h (target > 50%).
- **Aha moment:** time-to-first-summary after signup (target < 10 min).
- **Retention proxy:** % of orgs with ≥1 alert acknowledged or ≥1 digest opened weekly.
- **Revenue:** first paying customer; then trial→paid conversion.
- **Trust/quality:** alert false-positive rate (keep low to avoid fatigue churn).

## Out of scope (v1)

- "Every AI tool" capture. Infra/APM monitoring. Real-time streaming dashboards. Mobile app. Team collaboration features beyond a single owner. Self-hosting.

## Key risks (carry into build decisions)

1. **Capture coverage** — webhooks only fire if the user instruments them; gaps look like the product failing.
2. **Willingness to pay** — must stay a painkiller; if it drifts to "diary," churn rises.
3. **Distribution** — the hard 40%; must run in parallel from day one, not week six.
4. **Compliance framing** — do not over-claim EU AI Act applicability; most US SMBs aren't in scope.
