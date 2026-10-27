#!/usr/bin/env bash
# Applies the migration to a throwaway local Postgres with Supabase stand-ins (auth.jwt, roles),
# runs it twice (it must be re-runnable), runs the checks, then the rollback, then applies it again.
# Usage: PGHOST=/tmp/pgtest PGPORT=5433 PGUSER=postgres scripts/test-db.sh   (never against production)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=hostly_os_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -v ON_ERROR_STOP=1 -d $DB "$@"; }
run <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
SQL
run -f supabase/migrations/0001_hostly_core.sql
run -f supabase/migrations/0001_hostly_core.sql
run -f supabase/tests/hostly_core_test.sql
run -f supabase/rollback/0001_hostly_core_down.sql
run -f supabase/migrations/0001_hostly_core.sql
echo "rollback and re-apply OK"
