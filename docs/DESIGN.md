# DESIGN — UI/UX Guide

## Design principles

- **Calm, scannable, non-technical.** The user is a busy owner, not an engineer. One sentence per event. No jargon ("payload", "webhook" stay in settings/onboarding only).
- **Alerts are the hero.** The dashboard should answer "is anything wrong?" in the first second. Healthy = quiet/green; problems = obvious.
- **Plain English everywhere.** Summaries, alerts, and the digest read like a colleague's note, not a log line.
- **Trust through clarity.** Show timestamps, source, and "what we know" honestly. Never imply we captured more than we did.

## Component library

- **shadcn/ui + Tailwind.** Use shadcn primitives (Card, Table, Badge, Dialog, Tabs, Toast, Button, Input). Don't hand-roll components shadcn already provides.
- Icons: `lucide-react`.

## Color palette (suggested)

| Token | Use |
|---|---|
| Neutral background / surfaces | Tailwind `zinc`/`slate` scale |
| Primary action | a single brand hue (e.g. indigo-600) |
| Healthy / success | emerald-600 |
| Warning (anomaly) | amber-500 |
| Critical (failure/stalled) | red-600 |
| Muted text | zinc-500 |

Keep it to one brand color + semantic status colors. Status color is meaningful here — reserve red/amber strictly for alerts.

## Typography

- System UI / `Inter` for body and UI. One display weight for headings. Generous line height for summaries (they're read quickly).

## Screen / page list

1. **Auth** — magic-link sign in/up.
2. **Dashboard (home)** — top: alert banner (or "All clear"); below: recent activity timeline (plain-English summaries with source + time).
3. **Activity** — full event timeline, filters (endpoint, date range, errors only), search.
4. **Event detail** — the summary, structured fields, source, timestamp, and a collapsible raw payload (advanced).
5. **Alerts** — open + resolved alerts, with resolve action.
6. **Endpoints / Connections** — list of instrumented automations; create endpoint (shows key + secret once); per-platform setup guide; rotate secret.
7. **Settings** — org name, retention, redaction config, notification preferences.
8. **Billing** — current plan, usage vs quota, upgrade (Stripe Checkout), manage (Billing Portal).
9. **Onboarding** — guided: create first endpoint → copy setup snippet → "waiting for first event" live state → success.

## Empty & waiting states (high value here)

- "Waiting for your first event" with the exact setup steps and a live indicator — this is the activation moment; make it delightful and obvious.
- Healthy dashboard: a reassuring "All automations running normally" rather than a blank screen.

## Responsive

- Mobile-first for the dashboard and alerts (owners check on phones). Tables collapse to stacked cards under `md`. Settings/billing can be desktop-optimized.

## Email design (Resend)

- **Alert email:** subject states the problem plainly ("⚠️ Your invoicing automation stopped running"); body = what, when, which automation, one suggested next step.
- **Daily digest:** short narrative + bullet list of notable actions + any open alerts at top.
