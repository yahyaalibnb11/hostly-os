-- Hostly OS: channel calendar (.ics) links per listing, and when they last synced.
alter table public.hostly_properties add column if not exists calendar_urls jsonb not null default '{}'::jsonb;  -- {"airbnb": "https://…ics", "vrbo": "…"}
alter table public.hostly_properties add column if not exists calendar_synced_at timestamptz;
alter table public.hostly_properties add column if not exists calendar_error text;
