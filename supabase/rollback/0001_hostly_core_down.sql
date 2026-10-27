-- Undo supabase/migrations/0001_hostly_core.sql. Drops only the hostly_* objects it created;
-- -- Export the hostly_* tables first if they hold anything you want to keep.
drop function if exists public.hostly_kpis(date, date, text);
drop function if exists public.hostly_claim_events(integer);
drop function if exists public.hostly_finish_event(uuid, text, boolean);
drop view if exists public.hostly_agent_quality;
drop table if exists public.hostly_approvals, public.hostly_autonomy, public.hostly_automation_runs, public.hostly_events,
  public.hostly_pricing_recs, public.hostly_suppressions, public.hostly_tasks, public.hostly_incidents,
  public.hostly_messages, public.hostly_reservations, public.hostly_leads, public.hostly_properties,
  public.hostly_client_users, public.hostly_clients, public.hostly_markets, public.hostly_audit_log cascade;
drop function if exists public.hostly_audit_row();
drop function if exists public.hostly_audit_approval();
drop function if exists public.hostly_audit_immutable();
drop function if exists public.hostly_claim_first_owner();
drop table if exists public.hostly_staff;
drop function if exists public.hostly_is_staff();
drop function if exists public.hostly_my_email();
