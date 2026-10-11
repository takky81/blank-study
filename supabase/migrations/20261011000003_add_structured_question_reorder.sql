-- Structured question bank: atomically reorder the complete question set of a
-- keyword using an optimistic version token for every question.

create or replace function private.lock_structured_question_keyword_set()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Creates and reorders take this lock before touching question rows. This
  -- makes the keyword row the serialization point for membership changes.
  perform 1
  from public.keywords
  where id = new.keyword_id and owner_id = new.owner_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'question keyword not found';
  end if;
  return new;
end;
$$;

create trigger structured_questions_lock_keyword_set
  before insert on public.structured_questions
  for each row execute function private.lock_structured_question_keyword_set();

create or replace function public.reorder_structured_questions(
  p_keyword_id uuid,
  p_ordered jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_versions bigint[];
  v_input_count integer;
  v_question_count integer;
  v_conflict public.structured_questions%rowtype;
  v_questions jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_keyword_id is null then
    raise exception using errcode = '22023', message = 'keyword id is required';
  end if;
  if jsonb_typeof(p_ordered) <> 'array' then
    raise exception using errcode = '22023', message = 'ordered questions must be an array';
  end if;
  -- Lock order is always keyword first, then question rows. The insert trigger
  -- takes the same keyword lock before creating a new set member.
  perform 1
  from public.keywords
  where id = p_keyword_id and owner_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'keyword not found';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_ordered) as item(value)
    where jsonb_typeof(value) <> 'object'
       or not (value ? 'id' and value ? 'version')
       or (select count(*) from jsonb_object_keys(value)) <> 2
       or jsonb_typeof(value -> 'id') <> 'string'
       or jsonb_typeof(value -> 'version') <> 'number'
       or (value ->> 'version') !~ '^[0-9]+$'
  ) then
    raise exception using errcode = '22023', message = 'invalid ordered question token';
  end if;

  select array_agg((value ->> 'id')::uuid order by ordinal),
         array_agg((value ->> 'version')::bigint order by ordinal),
         count(*)::integer
    into v_ids, v_versions, v_input_count
  from jsonb_array_elements(p_ordered) with ordinality as item(value, ordinal);

  if v_input_count <> coalesce((select count(distinct id) from unnest(v_ids) as id), 0) then
    raise exception using errcode = '22023', message = 'ordered question ids must be unique';
  end if;

  -- Lock the whole set before comparing it with the caller's complete snapshot.
  perform 1
  from public.structured_questions
  where keyword_id = p_keyword_id and owner_id = v_actor
  order by id
  for update;

  select count(*)::integer into v_question_count
  from public.structured_questions
  where keyword_id = p_keyword_id and owner_id = v_actor;

  if v_input_count <> v_question_count
     or exists (
       select 1 from unnest(coalesce(v_ids, '{}'::uuid[])) as requested(id)
       where not exists (
         select 1 from public.structured_questions as question
         where question.id = requested.id
           and question.keyword_id = p_keyword_id
           and question.owner_id = v_actor
       )
     ) then
    raise exception using errcode = '22023', message = 'ordered questions must match the keyword question set';
  end if;

  select question.* into v_conflict
  from unnest(
    coalesce(v_ids, '{}'::uuid[]),
    coalesce(v_versions, '{}'::bigint[])
  ) with ordinality as requested(id, expected_version, ordinal)
  join public.structured_questions as question
    on question.id = requested.id
  where question.version <> requested.expected_version
  order by requested.ordinal
  limit 1;

  if found then
    return jsonb_build_object('kind', 'version-conflict', 'current', to_jsonb(v_conflict));
  end if;

  update public.structured_questions as question
  set sort_order = requested.ordinal - 1
  from unnest(coalesce(v_ids, '{}'::uuid[])) with ordinality as requested(id, ordinal)
  where question.id = requested.id
    and question.keyword_id = p_keyword_id
    and question.owner_id = v_actor;

  select coalesce(jsonb_agg(to_jsonb(question) order by question.sort_order, question.id), '[]'::jsonb)
    into v_questions
  from public.structured_questions as question
  where question.keyword_id = p_keyword_id and question.owner_id = v_actor;

  return jsonb_build_object('kind', 'saved', 'questions', v_questions);
end;
$$;
