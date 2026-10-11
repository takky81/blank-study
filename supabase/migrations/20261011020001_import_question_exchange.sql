-- question-generation-exchange task 4.1: atomic import orchestration RPC.
-- Every operation is re-validated against auth.uid() and current DB state
-- before any change. Only after the whole payload passes does the RPC delegate
-- each operation to the bank-owned private.apply_structured_question_content,
-- which re-validates owner/keyword/question/version/content/flags itself.
-- Any failure raises and rolls back the whole call (no partial save).
-- Error signalling: 22023 = validation, P0002 = unknown/foreign reference
-- (same representation), PT409 (HTTP 409) = stale expectedVersion. DETAIL names the
-- operation path only (no current content/version is disclosed).
-- Grants on schema private / the primitive are owned by the bank migrations
-- (20261011000004, 20261011000005); this migration relies on them unchanged.

create or replace function public.import_question_exchange(
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_ops jsonb;
  v_op jsonb;
  v_content jsonb;
  v_idx integer;
  v_path text;
  v_kind text;
  v_keyword_id uuid;
  v_question_id uuid;
  v_question public.structured_questions%rowtype;
  v_seen uuid[] := '{}'::uuid[];
  v_source text[];
  v_resolved text[];
  v_patch jsonb;
  v_result jsonb;
  v_created integer := 0;
  v_updated integer := 0;
  v_cleared_doubt integer := 0;
  v_cleared_explanation integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload -> 'schemaVersion' is distinct from '1'::jsonb
     or jsonb_typeof(p_payload -> 'operations') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'operations') = 0 then
    raise exception using errcode = '22023', message = 'invalid import payload';
  end if;
  v_ops := p_payload -> 'operations';

  -- Phase 1: validate every operation before any change.
  for v_idx in 0 .. jsonb_array_length(v_ops) - 1 loop
    v_op := v_ops -> v_idx;
    v_path := format('operations[%s]', v_idx);
    if jsonb_typeof(v_op) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid operation', detail = v_path;
    end if;
    v_kind := v_op ->> 'kind';
    if v_kind is null or v_kind not in ('create', 'update') then
      raise exception using errcode = '22023', message = 'invalid operation kind', detail = v_path;
    end if;
    if jsonb_typeof(v_op -> 'keywordId') is distinct from 'string'
       or (v_op ->> 'keywordId') !~ v_uuid_re then
      raise exception using errcode = '22023', message = 'invalid keyword id', detail = v_path;
    end if;
    v_keyword_id := (v_op ->> 'keywordId')::uuid;
    perform 1 from public.keywords where id = v_keyword_id and owner_id = v_actor;
    if not found then
      raise exception using errcode = 'P0002', message = 'keyword not found', detail = v_path;
    end if;

    v_content := v_op -> 'question';
    if jsonb_typeof(v_content) is distinct from 'object'
       or jsonb_typeof(v_content -> 'questionText') is distinct from 'string'
       or jsonb_typeof(v_content -> 'modelAnswer') is distinct from 'string'
       or jsonb_typeof(v_content -> 'choices') is distinct from 'array'
       or (v_content ? 'explanation' and v_content -> 'explanation' <> 'null'::jsonb
           and jsonb_typeof(v_content -> 'explanation') <> 'string')
       or btrim(v_content ->> 'questionText') = ''
       or btrim(v_content ->> 'modelAnswer') = ''
       or exists (
         select 1 from jsonb_array_elements(v_content -> 'choices') as c(value)
         where jsonb_typeof(c.value) <> 'string' or btrim(c.value #>> '{}') = ''
       ) then
      raise exception using errcode = '22023', message = 'invalid question content', detail = v_path;
    end if;

    if v_kind = 'create' then
      if v_op ? 'questionId' or v_op ? 'expectedVersion' then
        raise exception using errcode = '22023', message = 'create must not carry question id', detail = v_path;
      end if;
      continue;
    end if;

    if jsonb_typeof(v_op -> 'questionId') is distinct from 'string'
       or (v_op ->> 'questionId') !~ v_uuid_re then
      raise exception using errcode = '22023', message = 'invalid question id', detail = v_path;
    end if;
    v_question_id := (v_op ->> 'questionId')::uuid;
    if v_question_id = any(v_seen) then
      raise exception using errcode = '22023', message = 'duplicate question id', detail = v_path;
    end if;
    v_seen := array_append(v_seen, v_question_id);

    select * into v_question
    from public.structured_questions
    where id = v_question_id and owner_id = v_actor
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'question not found', detail = v_path;
    end if;
    if v_question.keyword_id <> v_keyword_id then
      raise exception using errcode = '22023', message = 'question and keyword do not match', detail = v_path;
    end if;
    if jsonb_typeof(v_op -> 'expectedVersion') is distinct from 'number'
       or (v_op ->> 'expectedVersion') !~ '^[1-9][0-9]{0,17}$' then
      raise exception using errcode = '22023', message = 'invalid expected version', detail = v_path;
    end if;
    if (v_op ->> 'expectedVersion')::bigint <> v_question.version then
      raise exception using errcode = 'PT409', message = 'version conflict', detail = v_path;
    end if;

    if jsonb_typeof(v_op -> 'sourceRequestedFlags') is distinct from 'array'
       or jsonb_typeof(v_op -> 'resolvedFlags') is distinct from 'array'
       or exists (
         select 1 from (
           select value from jsonb_array_elements(v_op -> 'sourceRequestedFlags')
           union all
           select value from jsonb_array_elements(v_op -> 'resolvedFlags')
         ) as f
         where f.value not in ('"doubt"'::jsonb, '"explanation-request"'::jsonb)
       ) then
      raise exception using errcode = '22023', message = 'invalid resolved flags', detail = v_path;
    end if;
    select coalesce(array_agg(value), '{}') into v_source
    from jsonb_array_elements_text(v_op -> 'sourceRequestedFlags');
    select coalesce(array_agg(value), '{}') into v_resolved
    from jsonb_array_elements_text(v_op -> 'resolvedFlags');
    if not (v_resolved <@ v_source)
       or (select count(distinct x) from unnest(v_resolved) as x) <> cardinality(v_resolved) then
      raise exception using errcode = '22023',
        message = 'resolved flags must be a subset of requested flags', detail = v_path;
    end if;
    if ('doubt' = any(v_resolved) and not v_question.doubt_flag)
       or ('explanation-request' = any(v_resolved) and not v_question.explanation_request_flag) then
      raise exception using errcode = '22023', message = 'resolved flags are not currently set', detail = v_path;
    end if;
  end loop;

  -- Phase 2: delegate each validated operation to the bank primitive. The
  -- primitive re-validates and raises on any violation, aborting the whole call.
  for v_idx in 0 .. jsonb_array_length(v_ops) - 1 loop
    v_op := v_ops -> v_idx;
    v_content := v_op -> 'question';
    v_content := jsonb_build_object(
      'question_text', v_content -> 'questionText',
      'model_answer', v_content -> 'modelAnswer',
      'choices', v_content -> 'choices',
      'explanation', coalesce(v_content -> 'explanation', 'null'::jsonb)
    );
    v_patch := '{}'::jsonb;
    if v_op ->> 'kind' = 'create' then
      v_result := private.apply_structured_question_content(
        gen_random_uuid(), (v_op ->> 'keywordId')::uuid, null, v_content,
        jsonb_build_object('__create', true)
      );
    else
      if v_op -> 'resolvedFlags' @> '["doubt"]'::jsonb then
        v_patch := v_patch || jsonb_build_object('doubt_flag', false);
      end if;
      if v_op -> 'resolvedFlags' @> '["explanation-request"]'::jsonb then
        v_patch := v_patch || jsonb_build_object('explanation_request_flag', false);
      end if;
      v_result := private.apply_structured_question_content(
        (v_op ->> 'questionId')::uuid, (v_op ->> 'keywordId')::uuid,
        (v_op ->> 'expectedVersion')::bigint, v_content, v_patch
      );
    end if;
    if v_result ->> 'kind' is distinct from 'saved' then
      raise exception using errcode = 'PT409', message = 'version conflict',
        detail = format('operations[%s]', v_idx);
    end if;
    if v_op ->> 'kind' = 'create' then
      v_created := v_created + 1;
    else
      v_updated := v_updated + 1;
      if v_patch ? 'doubt_flag' then v_cleared_doubt := v_cleared_doubt + 1; end if;
      if v_patch ? 'explanation_request_flag' then
        v_cleared_explanation := v_cleared_explanation + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'createdCount', v_created,
    'updatedCount', v_updated,
    'clearedDoubtCount', v_cleared_doubt,
    'clearedExplanationRequestCount', v_cleared_explanation
  );
end;
$$;

revoke all on function public.import_question_exchange(jsonb) from public, anon, service_role;
grant execute on function public.import_question_exchange(jsonb) to authenticated;
