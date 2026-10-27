-- Local check of 0001_hostly_core.sql against plain Postgres with Supabase stand-ins.
-- Run: scripts/test-db.sh (needs a throwaway Postgres; never run against production).
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Seed: one staff member, one client user, a live property, one stay.
insert into public.hostly_staff (email, role) values ('ops@hostly.pk', 'owner');
insert into public.hostly_clients (id, market, name, email) values ('11111111-1111-1111-1111-111111111111', 'US-FL', 'Owner A', 'a@owner.com');
insert into public.hostly_clients (id, market, name, email) values ('22222222-2222-2222-2222-222222222222', 'US-FL', 'Owner B', 'b@owner.com');
insert into public.hostly_client_users values ('a@owner.com', '11111111-1111-1111-1111-111111111111');
insert into public.hostly_properties (id, client_id, market, code, name, timezone, currency, status, base_price, min_price, max_price)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'US-FL', 'KIS-01', 'Kissimmee Villa', 'America/New_York', 'USD', 'live', 200, 120, 450),
       ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'US-FL', 'KIS-02', 'Other Owner Villa', 'America/New_York', 'USD', 'live', 180, 100, 400);
insert into public.hostly_reservations (property_id, channel, external_ref, check_in, check_out, currency, gross_amount)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'airbnb', 'HM1', '2026-11-01', '2026-11-05', 'USD', 800);

-- Double booking is refused.
do $$ begin
  insert into public.hostly_reservations (property_id, channel, external_ref, check_in, check_out, currency)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'booking', 'B9', '2026-11-04', '2026-11-06', 'USD');
  raise exception 'FAIL: overlap accepted';
exception when exclusion_violation then raise notice 'ok: overlap refused'; end $$;
-- Back-to-back stays and cancelled overlaps are fine.
insert into public.hostly_reservations (property_id, channel, external_ref, check_in, check_out, currency, gross_amount)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'booking', 'B10', '2026-11-05', '2026-11-07', 'USD', 400);
insert into public.hostly_reservations (property_id, channel, external_ref, status, check_in, check_out, currency)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'direct', 'D1', 'cancelled', '2026-11-02', '2026-11-03', 'USD');

-- Same webhook twice = one event.
insert into public.hostly_events (source, external_id, type, payload) values ('hostaway', 'evt-1', 'reservation.created', '{}') on conflict do nothing;
insert into public.hostly_events (source, external_id, type, payload) values ('hostaway', 'evt-1', 'reservation.created', '{}') on conflict do nothing;
do $$ begin if (select count(*) from public.hostly_events) <> 1 then raise exception 'FAIL: duplicate event'; end if; end $$;

-- Claim, fail with backoff, then dead-letter after 6 tries.
do $$ declare e public.hostly_events; s text; i int;
begin
  select * into e from public.hostly_claim_events(5);
  if e.status <> 'processing' then raise exception 'FAIL: not claimed'; end if;
  if (select count(*) from public.hostly_claim_events(5)) <> 0 then raise exception 'FAIL: claimed twice'; end if;
  s := public.hostly_finish_event(e.id, 'boom');
  if s <> 'failed' then raise exception 'FAIL: expected failed, got %', s; end if;
  for i in 2..6 loop
    update public.hostly_events set next_attempt_at = now() - interval '1 second' where id = e.id;
    perform public.hostly_claim_events(5);
    s := public.hostly_finish_event(e.id, 'boom');
  end loop;
  if s <> 'dead' then raise exception 'FAIL: expected dead, got %', s; end if;
  raise notice 'ok: retries then dead-letter';
end $$;

-- Audit log records changes and can't be edited.
update public.hostly_properties set base_price = 210 where code = 'KIS-01';
do $$ begin
  if not exists (select 1 from public.hostly_audit_log where entity = 'hostly_properties' and action = 'update') then raise exception 'FAIL: no audit row'; end if;
  begin update public.hostly_audit_log set actor = 'x'; raise exception 'FAIL: audit editable';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  raise notice 'ok: audit log append-only';
end $$;

-- Autonomy can't exceed its ceiling; changes are audited; quality view counts decisions.
do $$ begin
  begin update public.hostly_autonomy set level = 3 where agent = 'concierge' and action = 'sensitive_reply'; raise exception 'FAIL: ceiling ignored';
  exception when check_violation then null; end;
  update public.hostly_autonomy set level = 2, updated_by = 'ops@hostly.pk' where agent = 'concierge' and action = 'send_guest_reply';
  if not exists (select 1 from public.hostly_audit_log where entity = 'hostly_autonomy') then raise exception 'FAIL: autonomy change not audited'; end if;
  insert into public.hostly_approvals (agent, action, level, title, payload, status, edited) values
    ('concierge', 'send_guest_reply', 'L1', 'a', '{}', 'executed', false),
    ('concierge', 'send_guest_reply', 'L1', 'b', '{}', 'approved', true),
    ('concierge', 'send_guest_reply', 'L1', 'c', '{}', 'rejected', false),
    ('concierge', 'send_guest_reply', 'L1', 'd', '{}', 'pending', false);
  if (select accuracy from public.hostly_agent_quality where action = 'send_guest_reply') <> 0.3333 then raise exception 'FAIL: quality %', (select row_to_json(q) from public.hostly_agent_quality q); end if;
  raise notice 'ok: autonomy ladder';
end $$;

-- KPIs for November: 6 booked nights of 30, revenue 1200.
do $$ declare k record; begin
  select * into k from public.hostly_kpis('2026-11-01', '2026-12-01') where code = 'KIS-01';
  if k.booked_nights <> 6 or k.revenue <> 1200 or k.adr <> 200 or k.occupancy <> 0.2 then raise exception 'FAIL: kpis %', row_to_json(k); end if;
  -- A range cutting a stay counts only the nights inside it: Nov 3-5 = 2 nights of HM1 = 400.
  select * into k from public.hostly_kpis('2026-11-03', '2026-11-05') where code = 'KIS-01';
  if k.booked_nights <> 2 or k.revenue <> 400 then raise exception 'FAIL: split kpis %', row_to_json(k); end if;
  raise notice 'ok: kpis';
end $$;

-- Row level security: a client sees only their own property and stays; strangers see nothing.
set role authenticated;
select set_config('request.jwt.claims', '{"email":"a@owner.com"}', false);
do $$ begin
  if (select count(*) from public.hostly_properties) <> 1 then raise exception 'FAIL: client sees % properties', (select count(*) from public.hostly_properties); end if;
  if (select count(*) from public.hostly_reservations) <> 3 then raise exception 'FAIL: client stays'; end if;
  if (select count(*) from public.hostly_events) <> 0 then raise exception 'FAIL: client sees events'; end if;
  if (select count(*) from public.hostly_kpis('2026-11-01', '2026-12-01')) <> 1 then raise exception 'FAIL: client kpis'; end if;
  raise notice 'ok: client isolation';
end $$;
select set_config('request.jwt.claims', '{"email":"stranger@x.com"}', false);
do $$ begin
  if (select count(*) from public.hostly_properties) <> 0 then raise exception 'FAIL: stranger sees properties'; end if;
  raise notice 'ok: stranger sees nothing';
end $$;
select set_config('request.jwt.claims', '{"email":"ops@hostly.pk"}', false);
do $$ begin
  if (select count(*) from public.hostly_properties) <> 2 then raise exception 'FAIL: staff properties'; end if;
  begin insert into public.hostly_tasks (kind, title) values ('other', 'x'); raise exception 'FAIL: browser write allowed';
  exception when insufficient_privilege then null; end;
  raise notice 'ok: staff read-only from browser';
end $$;
-- Only an empty staff list can be claimed: a stranger signing in later gets nothing.
select set_config('request.jwt.claims', '{"email":"stranger@x.com"}', false);
do $$ begin
  if public.hostly_claim_first_owner() is not null then raise exception 'FAIL: stranger claimed a seat'; end if;
  raise notice 'ok: first-owner claim closed';
end $$;
reset role;
\echo ALL HOSTLY DB CHECKS PASSED
