# SCHEMA

Source of truth for the database. Mirror changes into `supabase/migrations/`. RLS is mandatory on every table.

## Tables

| Table | Purpose |
|---|---|
| `orgs` | Tenant boundary; plan, quota, retention. |
| `org_members` | User ↔ org membership + role. |
| `endpoints` | One per instrumented automation; holds `endpoint_key` (URL) + `signing_secret` (HMAC). |
| `events` | Raw ingested payloads + extracted structured fields + status. |
| `summaries` | Plain-English summary per event. |
| `alerts` | Failure / stalled / volume anomaly alerts. |
| `subscriptions` | Stripe billing state per org. |

## SQL

```sql
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',            -- free | starter | pro
  monthly_event_quota int not null default 500,
  retention_days int not null default 30,
  created_at timestamptz default now()
);

create table org_members (
  org_id uuid references orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'owner',
  primary key (org_id, user_id)
);

create table endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  label text not null,                          -- "Zapier - CRM sync"
  endpoint_key text not null unique,            -- random; goes in URL
  signing_secret text not null,                 -- random; HMAC secret
  source text,                                  -- zapier | make | n8n | custom
  expected_interval_seconds int,                -- for stalled detection (nullable)
  is_active boolean default true,
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  endpoint_id uuid not null references endpoints(id) on delete cascade,
  raw_payload jsonb not null,
  dedup_key text,                               -- idempotency
  status text not null default 'pending',       -- pending | summarized | failed
  is_error boolean default false,               -- payload indicated a failure
  action_type text,                             -- created | updated | deleted | sent | ...
  object_type text,                             -- contact | email | invoice | ...
  object_count int,
  target_system text,                           -- hubspot | gmail | ...
  occurred_at timestamptz default now(),
  created_at timestamptz default now()
);
create index on events (org_id, occurred_at desc);
create index on events (endpoint_id, occurred_at desc);
create unique index on events (org_id, dedup_key) where dedup_key is not null;

create table summaries (
  event_id uuid primary key references events(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  text text not null,
  model text,
  created_at timestamptz default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  endpoint_id uuid references endpoints(id) on delete set null,
  kind text not null,                           -- failure_spike | volume_anomaly | stalled
  message text not null,
  severity text not null default 'warning',     -- info | warning | critical
  resolved boolean default false,
  created_at timestamptz default now()
);
create index on alerts (org_id, created_at desc);

create table subscriptions (
  org_id uuid primary key references orgs(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free',
  status text,                                  -- active | past_due | canceled
  current_period_end timestamptz,
  updated_at timestamptz default now()
);
```

## Row-Level Security

```sql
alter table orgs           enable row level security;
alter table org_members    enable row level security;
alter table endpoints      enable row level security;
alter table events         enable row level security;
alter table summaries      enable row level security;
alter table alerts         enable row level security;
alter table subscriptions  enable row level security;

-- A user may read/write rows for orgs they belong to.
create policy "member orgs"          on orgs          for select
  using (id in (select org_id from org_members where user_id = auth.uid()));

create policy "member org_members"   on org_members   for select
  using (user_id = auth.uid());

create policy "member endpoints"     on endpoints     for all
  using (org_id in (select org_id from org_members where user_id = auth.uid()))
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));

create policy "member events"        on events        for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

create policy "member summaries"     on summaries     for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

create policy "member alerts"        on alerts        for all
  using (org_id in (select org_id from org_members where user_id = auth.uid()))
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));

create policy "member subscriptions" on subscriptions for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
```

> Writes to `events`, `summaries`, and `subscriptions` happen only from background jobs / Stripe webhook using the **service-role** client (bypasses RLS). Those code paths MUST set `org_id` explicitly.

## Seed structure (dev)

One `orgs` row (plan `pro`), one `org_members` linking your test user, one `endpoints` row with a generated key + secret. Send a signed test event to verify the full pipeline (see `docs/API.md`).
