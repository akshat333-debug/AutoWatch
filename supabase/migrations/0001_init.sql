create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
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
  label text not null,
  endpoint_key text not null unique,
  signing_secret text not null,
  source text,
  expected_interval_seconds int,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  endpoint_id uuid not null references endpoints(id) on delete cascade,
  raw_payload jsonb not null,
  dedup_key text,
  status text not null default 'pending',
  is_error boolean default false,
  action_type text,
  object_type text,
  object_count int,
  target_system text,
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
  kind text not null,
  message text not null,
  severity text not null default 'warning',
  resolved boolean default false,
  created_at timestamptz default now()
);
create index on alerts (org_id, created_at desc);

create table subscriptions (
  org_id uuid primary key references orgs(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free',
  status text,
  current_period_end timestamptz,
  updated_at timestamptz default now()
);

-- RLS
alter table orgs           enable row level security;
alter table org_members    enable row level security;
alter table endpoints      enable row level security;
alter table events         enable row level security;
alter table summaries      enable row level security;
alter table alerts         enable row level security;
alter table subscriptions  enable row level security;

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
