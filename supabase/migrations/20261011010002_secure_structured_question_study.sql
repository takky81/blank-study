-- Structured question study: owner-scoped Data API and record RPC boundary.

alter table public.structured_question_stats enable row level security;
alter table public.structured_question_answer_logs enable row level security;

create policy structured_question_stats_owner_select
  on public.structured_question_stats
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy structured_question_stats_owner_insert
  on public.structured_question_stats
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy structured_question_stats_owner_update
  on public.structured_question_stats
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy structured_question_answer_logs_owner_select
  on public.structured_question_answer_logs
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy structured_question_answer_logs_owner_insert
  on public.structured_question_answer_logs
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

-- SECURITY INVOKER makes the record RPC use these same owner policies. Stats
-- need upsert privileges; answer logs intentionally remain immutable events.
revoke all on table public.structured_question_stats from public, anon;
revoke all on table public.structured_question_answer_logs from public, anon;
revoke all on table public.structured_question_stats from authenticated;
revoke all on table public.structured_question_answer_logs from authenticated;
grant select, insert, update on table public.structured_question_stats to authenticated;
grant select, insert on table public.structured_question_answer_logs to authenticated;

-- The service role is reserved for fixture/setup and administrative checks; it
-- is never required by browser code.
grant all on table public.structured_question_stats,
  public.structured_question_answer_logs to service_role;

-- PostgreSQL grants EXECUTE to PUBLIC by default, so close that capability and
-- expose only the authenticated browser entry point.
revoke all on function public.record_structured_question_answer(uuid, bigint, text, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.record_structured_question_answer(uuid, bigint, text, text, timestamptz)
  to authenticated;

alter function public.record_structured_question_answer(uuid, bigint, text, text, timestamptz)
  security invoker;
alter function public.record_structured_question_answer(uuid, bigint, text, text, timestamptz)
  set search_path = '';
