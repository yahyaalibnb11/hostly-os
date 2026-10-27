-- Hostly OS 0003: per-listing guest info (wifi, check-in time, parking, house rules) that the Guest helper
-- may use when it drafts replies. Re-runnable.
alter table public.hostly_properties add column if not exists guest_info text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hostly_properties_guest_info_len') then
    alter table public.hostly_properties add constraint hostly_properties_guest_info_len check (guest_info is null or length(guest_info) <= 4000);
  end if;
end $$;
