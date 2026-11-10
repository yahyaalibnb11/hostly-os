-- Hostly Scout: the team's listing research before outreach.
-- Only the server (service role) reads and writes these tables; the browser goes through /api/scout/*.
-- Nothing is ever hard-deleted from the app: "delete" sets deleted_at, so no research is lost.

create table if not exists public.scout_members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  pin_hash text,                       -- scrypt hash, set by the server; never stored in this repo
  is_admin boolean not null default false,
  daily_goal int not null default 10 check (daily_goal between 1 and 200),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.scout_listings (
  id uuid primary key default gen_random_uuid(),
  link text not null,
  link_key text not null,
  market text not null,
  host_name text,
  host_listings int check (host_listings is null or host_listings between 0 and 100000),
  property_type text,
  title text,
  rating numeric(3,2) check (rating is null or rating between 0 and 5),
  reviews int check (reviews is null or reviews >= 0),
  currency text not null default 'EUR',
  weekday_price numeric(10,2) check (weekday_price is null or weekday_price >= 0),
  weekend_price numeric(10,2) check (weekend_price is null or weekend_price >= 0),
  min_nights int check (min_nights is null or min_nights between 0 and 365),
  photos int check (photos is null or photos between 0 and 1000),
  response_rate int check (response_rate is null or response_rate between 0 and 100),
  managed_by text not null default 'unknown',
  licence_number text,
  problems text[] not null default '{}',
  custom_problems text not null default '',
  problem_count int not null default 0,
  solutions text not null default '',
  score int not null default 0 check (score between 0 and 100),
  grade text not null default 'cold',
  pitch_subject text not null default '',
  pitch text not null default '',
  status text not null default 'new',
  contact text,
  notes text not null default '',
  added_by uuid not null references public.scout_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One listing link can be saved only once (among listings that aren't deleted).
create unique index if not exists scout_listings_link_key_live on public.scout_listings (link_key) where deleted_at is null;
create index if not exists scout_listings_added_by on public.scout_listings (added_by, created_at desc);
create index if not exists scout_listings_score on public.scout_listings (score desc) where deleted_at is null;

alter table public.scout_members enable row level security;
alter table public.scout_listings enable row level security;
-- No policies on purpose: anon and signed-in browser users can't read or write these tables directly.
revoke all on public.scout_members, public.scout_listings from anon, authenticated;

insert into public.scout_members (name, is_admin) values ('Yahya', true), ('Aon', false), ('Eassa', false), ('Shahzaib', false)
on conflict (name) do nothing;
