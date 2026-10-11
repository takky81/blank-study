-- Structured question bank: explicit Data API, RLS, and RPC delegation boundary.

alter table public.structured_questions enable row level security;

create policy structured_questions_owner_select on public.structured_questions
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy structured_questions_owner_insert on public.structured_questions
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy structured_questions_owner_update on public.structured_questions
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy structured_questions_owner_delete on public.structured_questions
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.structured_questions from public, anon;
grant select, insert, update, delete on table public.structured_questions to authenticated;
grant all on table public.structured_questions to service_role;

-- Trigger functions execute as part of the table operation and must not be
-- callable as standalone Data API routines by any API role.
revoke all on function public.set_structured_question_version()
  from public, anon, authenticated, service_role;

-- Functions receive EXECUTE from PUBLIC by default. Close that default before
-- granting only the browser-facing entry points to authenticated callers.
revoke all on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb)
  to authenticated;

revoke all on function public.reorder_structured_questions(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.reorder_structured_questions(uuid, jsonb)
  to authenticated;

-- private is deliberately absent from supabase/config.toml [api].schemas.
-- Remove inherited/default access to every private helper first, then restore
-- the one exact delegation capability required by the public mutation RPC.
revoke all on schema private from public, anon, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function private.lock_structured_question_keyword_set()
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

revoke all on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)
  to authenticated;

alter function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)
  security invoker;
alter function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)
  set search_path = '';

alter function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb)
  security invoker;
alter function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb)
  set search_path = '';

alter function public.reorder_structured_questions(uuid, jsonb)
  security invoker;
alter function public.reorder_structured_questions(uuid, jsonb)
  set search_path = '';
