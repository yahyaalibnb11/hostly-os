-- Hostly Scout: screenshots for the AI scan go straight from the phone to this private bucket (one small
-- upload each), so the scan request never hits Vercel's 4.5 MB body limit. Only the server hands out
-- signed upload / read links; files are deleted after the scan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scout-scans', 'scout-scans', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
