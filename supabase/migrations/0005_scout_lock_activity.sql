-- Hostly Scout: complete leads are handed over (assigned_to = who does the outreach), and an activity log
-- records who signed in, opened, added, changed, downloaded or searched what, and when.

alter table public.scout_listings add column if not exists assigned_to uuid references public.scout_members(id);

create table if not exists public.scout_activity (
  id bigserial primary key,
  member_id uuid not null references public.scout_members(id),
  action text not null,
  listing_id uuid references public.scout_listings(id),
  detail text not null default '',
  at timestamptz not null default now()
);
create index if not exists scout_activity_at on public.scout_activity (at desc);
create index if not exists scout_activity_member on public.scout_activity (member_id, at desc);

alter table public.scout_activity enable row level security;
-- No policies on purpose: only the server (service role) reads and writes it.
revoke all on public.scout_activity from anon, authenticated;
