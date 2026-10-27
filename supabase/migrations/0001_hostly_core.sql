-- Hostly OS core: its own staff list, relational records, event inbox, AI agent runs, autonomy levels,
-- approvals and an append-only audit log. Runs in Hostly OS's own Supabase project; it does not
-- reference any other app's tables.
-- Run once in Supabase: SQL Editor → New query → paste this file → Run. Safe to run again.
-- Rollback: supabase/rollback/0001_hostly_core_down.sql.

create extension if not exists btree_gist with schema extensions;

-- 0. Staff. Only emails on this list can read Hostly OS data. The first person to sign in becomes
--    the owner (hostly_claim_first_owner); after that owners/admins add teammates.
create or replace function public.hostly_my_email() returns text
language sql stable set search_path = '' as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;
revoke all on function public.hostly_my_email() from public, anon;
grant execute on function public.hostly_my_email() to authenticated;

create table if not exists public.hostly_staff (
  email text primary key check (email = lower(email)),
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  added_by text,
  added_at timestamptz not null default now()
);
alter table public.hostly_staff enable row level security;

create or replace function public.hostly_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hostly_staff where email = public.hostly_my_email())
$$;
revoke all on function public.hostly_is_staff() from public, anon;
grant execute on function public.hostly_is_staff() to authenticated;

drop policy if exists "staff read staff" on public.hostly_staff;
create policy "staff read staff" on public.hostly_staff for select to authenticated using (public.hostly_is_staff());

create or replace function public.hostly_claim_first_owner() returns text
language plpgsql security definer set search_path = public as $$
begin
  if public.hostly_my_email() = '' then return null; end if;
  perform pg_advisory_xact_lock(4310001);
  if not exists (select 1 from public.hostly_staff) then
    insert into public.hostly_staff (email, role, added_by) values (public.hostly_my_email(), 'owner', 'first sign-in');
  end if;
  return (select role from public.hostly_staff where email = public.hostly_my_email());
end $$;
revoke all on function public.hostly_claim_first_owner() from public, anon;
grant execute on function public.hostly_claim_first_owner() to authenticated;

-- 1. Markets and clients (property owners Hostly manages for).
create table if not exists public.hostly_markets (
  code text primary key check (code ~ '^[A-Z]{2}(-[A-Z0-9]+)?$'),
  name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone text not null,
  active boolean not null default true
);
insert into public.hostly_markets (code, name, currency, timezone) values
  ('PK', 'Pakistan', 'PKR', 'Asia/Karachi'),
  ('AE', 'United Arab Emirates', 'AED', 'Asia/Dubai'),
  ('GB', 'United Kingdom', 'GBP', 'Europe/London'),
  ('US-FL', 'United States: Florida', 'USD', 'America/New_York'),
  ('US-TN', 'United States: Tennessee', 'USD', 'America/Chicago')
on conflict (code) do nothing;

create table if not exists public.hostly_clients (
  id uuid primary key default gen_random_uuid(),
  market text not null references public.hostly_markets(code),
  name text not null,
  email text check (email is null or email = lower(email)),
  phone text,
  status text not null default 'onboarding' check (status in ('prospect', 'onboarding', 'active', 'paused', 'offboarded')),
  -- {"type": "percent", "rate": 0.155, "base": "net_booking_revenue"} or {"type": "flat", "amount": 1000, "currency": "AED"}.
  -- Versioned by contract_ref: a fee change is a new contract, never an edit of the old one.
  fee_model jsonb not null default '{}'::jsonb,
  contract_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hostly_client_users (
  email text not null check (email = lower(email)),
  client_id uuid not null references public.hostly_clients(id) on delete cascade,
  primary key (email, client_id)
);

-- 2. Properties, with the pricing guardrails every automation must respect.
create table if not exists public.hostly_properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.hostly_clients(id),
  market text not null references public.hostly_markets(code),
  code text not null unique,                 -- short stable id, e.g. BC201 (matches the unit id in Ember OS)
  name text not null,
  city text,
  address text,
  timezone text not null,
  inventory_type text not null default 'internal' check (inventory_type in ('internal', 'external', 'cohosted')),
  status text not null default 'onboarding' check (status in ('prospect', 'onboarding', 'live', 'paused', 'suspended', 'offboarded')),
  bedrooms smallint,
  capacity smallint,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  base_price numeric(12,2),
  min_price numeric(12,2),
  max_price numeric(12,2),
  max_discount_pct numeric(5,2) not null default 15 check (max_discount_pct between 0 and 90),
  -- Price changes larger than this % in one step always need a human.
  auto_change_limit_pct numeric(5,2) not null default 10 check (auto_change_limit_pct between 0 and 50),
  listing_ids jsonb not null default '{}'::jsonb,   -- {"airbnb": "123", "booking": "456"}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_price is null or max_price is null or min_price <= max_price)
);
create index if not exists hostly_properties_client on public.hostly_properties (client_id);

-- 3. Reservations. One row per (channel, external_ref); confirmed stays can't overlap on a property.
create table if not exists public.hostly_reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.hostly_properties(id),
  channel text not null,                    -- airbnb, booking, direct, whatsapp, hostaway, ...
  external_ref text not null,
  status text not null default 'confirmed' check (status in ('inquiry', 'confirmed', 'cancelled', 'blocked')),
  guest_name text,
  guest_count smallint,
  check_in date not null,
  check_out date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  gross_amount numeric(12,2),               -- what the guest paid for the stay (accommodation)
  fees_amount numeric(12,2),                -- cleaning and other guest fees
  payout_amount numeric(12,2),              -- what the channel pays out
  source_updated_at timestamptz,            -- the channel's own modified time, for out-of-order events
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_ref),
  check (check_out > check_in)
);
do $$ begin
  alter table public.hostly_reservations add constraint hostly_no_double_booking
    exclude using gist (property_id with =, daterange(check_in, check_out) with &&) where (status = 'confirmed');
exception when duplicate_object or duplicate_table then null; end $$;
create index if not exists hostly_reservations_dates on public.hostly_reservations (property_id, check_in);

-- 4. Guest messages and incidents. Bodies stay short-lived in spirit: no access codes or IDs here.
create table if not exists public.hostly_messages (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.hostly_reservations(id),
  property_id uuid references public.hostly_properties(id),
  channel text not null,
  direction text not null check (direction in ('in', 'out')),
  sender text,                              -- phone/handle on the channel (WhatsApp 24-hour window check)
  body text not null check (length(body) <= 8000),
  intent text,
  risk text check (risk in ('routine', 'sensitive', 'urgent', 'emergency')),
  draft_reply text,
  status text not null default 'new' check (status in ('new', 'drafted', 'awaiting_approval', 'sent', 'escalated', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.hostly_incidents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.hostly_properties(id),
  reservation_id uuid references public.hostly_reservations(id),
  message_id uuid references public.hostly_messages(id),
  severity text not null check (severity in ('low', 'medium', 'high', 'emergency')),
  category text not null,
  summary text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  owner_email text,
  respond_by timestamptz,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- 5. Work: turnovers, inspections, maintenance, onboarding, sales follow-ups.
--    dedupe_key makes "create the turnover for reservation X" safe to run twice.
create table if not exists public.hostly_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.hostly_properties(id),
  reservation_id uuid references public.hostly_reservations(id),
  lead_id uuid,
  kind text not null check (kind in ('cleaning', 'inspection', 'maintenance', 'onboarding', 'guest', 'sales', 'finance', 'other')),
  title text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  assignee text,
  details jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hostly_tasks_open on public.hostly_tasks (status, due_at);

-- 6. Leads (US co-hosting sales) and the suppression list every outbound send must check.
create table if not exists public.hostly_leads (
  id uuid primary key default gen_random_uuid(),
  market text not null references public.hostly_markets(code),
  name text,
  company text,
  email text check (email is null or email = lower(email)),
  phone text,
  lead_type text not null default 'host' check (lead_type in ('host', 'owner', 'realtor', 'investor', 'property_manager', 'other')),
  listing_url text,
  city text,
  source text not null default 'unknown',
  stage text not null default 'new' check (stage in ('new', 'qualified', 'audit_needed', 'approved_to_contact', 'contacted', 'replied', 'call_booked', 'proposal_sent', 'won', 'lost', 'suppressed')),
  score smallint check (score between 0 and 100),
  score_reason text,
  facts jsonb not null default '[]'::jsonb,         -- verified, with where each came from
  hypotheses jsonb not null default '[]'::jsonb,    -- guesses, never stated as fact in outreach
  next_action text,
  next_action_at timestamptz,
  owner_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hostly_leads_email on public.hostly_leads (email) where email is not null;
create unique index if not exists hostly_leads_listing on public.hostly_leads (listing_url) where listing_url is not null;

create table if not exists public.hostly_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text check (email is null or email = lower(email)),
  phone text,
  reason text not null,
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
create unique index if not exists hostly_suppressions_email on public.hostly_suppressions (email) where email is not null;
create unique index if not exists hostly_suppressions_phone on public.hostly_suppressions (phone) where phone is not null;

-- 7. Pricing recommendations: what the AI suggested, what the guardrails allowed, what happened.
create table if not exists public.hostly_pricing_recs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.hostly_properties(id),
  stay_date date not null,
  current_price numeric(12,2) not null,
  suggested_price numeric(12,2) not null,
  allowed_price numeric(12,2) not null,        -- after min/max/discount guardrails
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  rationale text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'awaiting_approval', 'approved', 'rejected', 'applied', 'expired')),
  created_at timestamptz not null default now(),
  unique (property_id, stay_date, created_at)
);

-- 8. Event inbox. Every webhook, sync and schedule lands here first, once per (source, external_id),
--    so a repeated delivery never repeats its side effects.
create table if not exists public.hostly_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, external_id)
);
create index if not exists hostly_events_queue on public.hostly_events (status, next_attempt_at);

-- 9. The AI agent workforce (blueprint 2.0, section 14): what every agent run did, the autonomy level of
--    each agent action, and the human approvals the agents are waiting on.
--    Autonomy ladder (section 1.3): L0 observe, L1 draft, L2 act with review, L3 act within guardrails, L4 human only.
create table if not exists public.hostly_automation_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.hostly_events(id),
  agent text not null,
  level text not null check (level in ('L0', 'L1', 'L2', 'L3', 'L4')),
  status text not null check (status in ('success', 'skipped', 'failed', 'awaiting_approval')),
  summary text,
  output jsonb not null default '{}'::jsonb,
  error text,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  duration_ms integer,
  started_at timestamptz not null default now()
);
create index if not exists hostly_runs_recent on public.hostly_automation_runs (started_at desc);
create unique index if not exists hostly_runs_once on public.hostly_automation_runs (event_id, agent) where event_id is not null and status <> 'failed';

-- Autonomy per agent action. Only owners/admins change it (through the server), every change is audited,
-- and max_level is a hard ceiling: actions in the permanent human-only list have max_level 1 (draft at most).
create table if not exists public.hostly_autonomy (
  agent text not null,
  action text not null,
  level smallint not null check (level between 0 and 4),
  max_level smallint not null check (max_level between 0 and 4),
  description text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (agent, action),
  check (level <= max_level)
);
insert into public.hostly_autonomy (agent, action, level, max_level, description) values
  ('field_ops',    'create_task',      2, 3, 'Create turnover cleans and inspections from reservations'),
  ('outreach',     'send_outreach',    1, 2, 'Send a first-touch email to a lead (CAN-SPAM opt-out line required)'),
  ('concierge',    'send_guest_reply', 1, 3, 'Send a routine reply to a guest from verified property facts'),
  ('concierge',    'sensitive_reply',  1, 1, 'Reply about refunds, complaints, damage or policy exceptions (human only)'),
  ('revenue',      'apply_price',      1, 3, 'Change a nightly price inside the owner''s min/max and discount limits'),
  ('exec_copilot', 'daily_brief',      0, 0, 'Morning brief for the owner (read only)')
on conflict (agent, action) do nothing;

create table if not exists public.hostly_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.hostly_automation_runs(id),
  agent text not null,
  action text not null,                    -- e.g. send_guest_reply, apply_price, send_outreach
  level text not null check (level in ('L1', 'L2', 'L3', 'L4')),
  title text not null,
  payload jsonb not null,                  -- exactly what will be executed if approved
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  edited boolean not null default false,   -- a person changed the draft before approving (counts against the agent's quality)
  result jsonb
);
create index if not exists hostly_approvals_pending on public.hostly_approvals (status, requested_at);

-- Earned autonomy (section 14.5): per agent action over the last 28 days, how many drafts people approved
-- unchanged, edited or rejected. An action is eligible to move up a level only at >= 200 decisions and >= 97% unchanged.
create or replace view public.hostly_agent_quality with (security_invoker = true) as
  select agent, action,
         count(*) filter (where status in ('approved', 'executed', 'failed') and not edited) as approved_unchanged,
         count(*) filter (where edited) as edited,
         count(*) filter (where status = 'rejected') as rejected,
         count(*) filter (where status <> 'pending') as decided,
         round(count(*) filter (where status in ('approved', 'executed', 'failed') and not edited)::numeric
               / nullif(count(*) filter (where status <> 'pending' and status <> 'expired'), 0), 4) as accuracy
  from public.hostly_approvals
  where requested_at > now() - interval '28 days'
  group by agent, action;

-- 10. Append-only audit log. Updates and deletes are refused, even for the service role.
create table if not exists public.hostly_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb
);
create or replace function public.hostly_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'hostly_audit_log is append-only'; end $$;
drop trigger if exists hostly_audit_immutable on public.hostly_audit_log;
create trigger hostly_audit_immutable before update or delete on public.hostly_audit_log
  for each row execute function public.hostly_audit_immutable();

-- Row changes on the records that matter are logged automatically.
create or replace function public.hostly_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(nullif(current_setting('hostly.actor', true), ''), nullif(public.hostly_my_email(), ''), current_user);
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  insert into public.hostly_audit_log (actor, action, entity, entity_id, before, after)
  values (who, lower(tg_op), tg_table_name,
          case when tg_op = 'DELETE' then coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'action') else coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'action') end,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
do $$ declare t text; begin
  foreach t in array array['hostly_clients', 'hostly_properties', 'hostly_reservations', 'hostly_leads', 'hostly_autonomy'] loop
    execute format('drop trigger if exists hostly_audit on public.%I', t);
    execute format('create trigger hostly_audit before insert or update or delete on public.%I for each row execute function public.hostly_audit_row()', t);
  end loop;
end $$;
-- Approvals keep no updated_at; log their decisions after the fact.
create or replace function public.hostly_audit_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.hostly_audit_log (actor, action, entity, entity_id, before, after)
    values (coalesce(new.decided_by, current_user), 'approval_' || new.status, 'hostly_approvals', new.id::text,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'note', new.decision_note));
  end if;
  return new;
end $$;
drop trigger if exists hostly_audit on public.hostly_approvals;
create trigger hostly_audit after update on public.hostly_approvals for each row execute function public.hostly_audit_approval();

-- 11. Queue helpers for the automation worker (server only).
-- Claims due events without two workers ever taking the same one.
create or replace function public.hostly_claim_events(p_limit integer default 20) returns setof public.hostly_events
language sql security definer set search_path = public as $$
  update public.hostly_events e set status = 'processing', attempts = e.attempts + 1
  where e.id in (
    select id from public.hostly_events
    where (status in ('pending', 'failed') and next_attempt_at <= now())
       or (status = 'processing' and next_attempt_at <= now() - interval '10 minutes')  -- crashed worker
    order by next_attempt_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning e.*;
$$;
-- Marks an event done, or schedules a retry with backoff; after 6 tries (or at once, for an event
-- that can never succeed, p_dead) it goes to the dead-letter state for a person to look at.
create or replace function public.hostly_finish_event(p_id uuid, p_error text default null, p_dead boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare a integer; s text;
begin
  if p_error is null then
    update public.hostly_events set status = 'done', processed_at = now(), last_error = null where id = p_id;
    return 'done';
  end if;
  select attempts into a from public.hostly_events where id = p_id;
  s := case when a >= 6 or p_dead then 'dead' else 'failed' end;
  update public.hostly_events
    set status = s, last_error = left(p_error, 2000),
        next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, a)::int))
  where id = p_id;
  return s;
end $$;
revoke all on function public.hostly_claim_events(integer) from public, anon, authenticated;
revoke all on function public.hostly_finish_event(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.hostly_claim_events(integer) to service_role;
grant execute on function public.hostly_finish_event(uuid, text, boolean) to service_role;

-- 12. Portfolio KPIs with written definitions (blueprint 8.2):
--     occupancy = booked nights / available nights; ADR = gross_amount / booked nights;
--     RevPAN = gross_amount / available nights. Blocked nights are removed from available nights.
--     Revenue is split by night, so a stay across the range edge only counts its nights inside it.
create or replace function public.hostly_kpis(p_from date, p_to date, p_market text default null)
returns table (property_id uuid, code text, currency text, available_nights integer, booked_nights integer,
               blocked_nights integer, revenue numeric, occupancy numeric, adr numeric, revpan numeric)
-- Runs as the caller, so row level security decides which properties count (staff: all, client: own).
language sql stable set search_path = public as $$
  with props as (
    select p.* from public.hostly_properties p
    where p.status = 'live' and (p_market is null or p.market = p_market)
  ), nights as (
    select r.property_id, r.status, d::date as night,
           case when r.status = 'confirmed' then coalesce(r.gross_amount, 0) / (r.check_out - r.check_in) else 0 end as rev
    from public.hostly_reservations r
    join props on props.id = r.property_id
    cross join lateral generate_series(greatest(r.check_in, p_from), least(r.check_out, p_to) - 1, interval '1 day') d
    where r.status in ('confirmed', 'blocked') and r.check_in < p_to and r.check_out > p_from
  ), agg as (
    select property_id,
           count(*) filter (where status = 'confirmed')::int as booked,
           count(*) filter (where status = 'blocked')::int as blocked,
           sum(rev) as revenue
    from nights group by property_id
  )
  select p.id, p.code, p.currency,
         greatest(0, (p_to - p_from) - coalesce(a.blocked, 0))::int,
         coalesce(a.booked, 0), coalesce(a.blocked, 0), round(coalesce(a.revenue, 0), 2),
         round(coalesce(a.booked, 0)::numeric / nullif((p_to - p_from) - coalesce(a.blocked, 0), 0), 4),
         round(coalesce(a.revenue, 0) / nullif(a.booked, 0), 2),
         round(coalesce(a.revenue, 0) / nullif((p_to - p_from) - coalesce(a.blocked, 0), 0), 2)
  from props p left join agg a on a.property_id = p.id
  order by p.code;
$$;
revoke all on function public.hostly_kpis(date, date, text) from public, anon;
grant execute on function public.hostly_kpis(date, date, text) to authenticated, service_role;

-- 13. Row level security. Staff read everything; clients read only their own properties and stays.
--     There are no browser write policies: every change goes through the server, which checks roles
--     and writes the audit trail.
do $$ declare t text; begin
  foreach t in array array['hostly_markets', 'hostly_clients', 'hostly_client_users', 'hostly_properties', 'hostly_reservations',
                           'hostly_messages', 'hostly_incidents', 'hostly_tasks', 'hostly_leads', 'hostly_suppressions',
                           'hostly_pricing_recs', 'hostly_events', 'hostly_automation_runs', 'hostly_autonomy', 'hostly_approvals', 'hostly_audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.hostly_is_staff())', t);
  end loop;
end $$;

drop policy if exists "client reads own" on public.hostly_clients;
create policy "client reads own" on public.hostly_clients for select to authenticated
  using (id in (select client_id from public.hostly_client_users where email = public.hostly_my_email()));
drop policy if exists "client reads own" on public.hostly_properties;
create policy "client reads own" on public.hostly_properties for select to authenticated
  using (client_id in (select client_id from public.hostly_client_users where email = public.hostly_my_email()));
drop policy if exists "client reads own" on public.hostly_reservations;
create policy "client reads own" on public.hostly_reservations for select to authenticated
  using (property_id in (select p.id from public.hostly_properties p
                         join public.hostly_client_users u on u.client_id = p.client_id
                         where u.email = public.hostly_my_email()));
drop policy if exists "client reads own link" on public.hostly_client_users;
create policy "client reads own link" on public.hostly_client_users for select to authenticated
  using (email = public.hostly_my_email());
drop policy if exists "anyone reads markets" on public.hostly_markets;
create policy "anyone reads markets" on public.hostly_markets for select to authenticated using (true);
