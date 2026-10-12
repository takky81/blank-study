-- Structured question doubt note: optional free text describing a doubt.
-- The note exists only while doubt_flag is true and is cleared with the flag.

alter table public.structured_questions add column doubt_note text;
alter table public.structured_questions
  add constraint structured_questions_doubt_note_check check (
    (doubt_note is null or doubt_flag)
    and (doubt_note is null or (btrim(doubt_note) = doubt_note and doubt_note <> ''))
    and (doubt_note is null or char_length(doubt_note) <= 1000)
  );

create or replace function private.apply_structured_question_content(
  p_question_id uuid,
  p_keyword_id uuid,
  p_expected_version bigint,
  p_content jsonb,
  p_flag_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_question public.structured_questions%rowtype;
  v_keyword public.keywords%rowtype;
  v_content jsonb;
  v_patch jsonb := coalesce(p_flag_patch, '{}'::jsonb);
  v_question_text text;
  v_model_answer text;
  v_explanation text;
  v_choices jsonb;
  v_choice jsonb;
  v_choice_text text;
  v_normalized_answer text;
  v_normalized_choice text;
  v_seen_choices text[] := '{}'::text[];
  v_doubt_flag boolean;
  v_doubt_note text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_question_id is null then
    raise exception using errcode = '22023', message = 'question id is required';
  end if;
  if jsonb_typeof(v_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(v_patch) as key
    where key not in (
      '__create', '__delete', 'doubt_flag', 'doubt_note', 'explanation_request_flag', 'is_active'
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid flag patch';
  end if;
  if v_patch ? 'doubt_note'
     and jsonb_typeof(v_patch -> 'doubt_note') not in ('string', 'null') then
    raise exception using errcode = '22023', message = 'invalid flag patch';
  end if;

  select * into v_question
  from public.structured_questions
  where id = p_question_id and owner_id = v_actor
  for update;

  if found then
    if coalesce((v_patch ->> '__create')::boolean, false) then
      raise exception using errcode = '23505', message = 'question already exists';
    end if;
    if p_keyword_id is not null and p_keyword_id <> v_question.keyword_id then
      raise exception using errcode = '22023', message = 'question and keyword do not match';
    end if;
    select * into v_keyword
    from public.keywords
    where id = v_question.keyword_id
      and owner_id = v_actor
      and material_id = v_question.material_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'keyword not found';
    end if;
    if p_expected_version is distinct from v_question.version then
      return jsonb_build_object('kind', 'version-conflict', 'current', to_jsonb(v_question));
    end if;
    if coalesce((v_patch ->> '__delete')::boolean, false) then
      delete from public.structured_questions
      where id = p_question_id and owner_id = v_actor and version = p_expected_version;
      return jsonb_build_object(
        'kind', 'deleted', 'id', v_question.id, 'version', v_question.version
      );
    end if;
    v_content := coalesce(p_content, jsonb_build_object(
      'question_text', v_question.question_text,
      'model_answer', v_question.model_answer,
      'choices', v_question.choices,
      'explanation', v_question.explanation
    ));
  else
    if not coalesce((v_patch ->> '__create')::boolean, false) then
      raise exception using errcode = 'P0002', message = 'question not found';
    end if;
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception using errcode = '22023', message = 'create expected version must be null or zero';
    end if;
    if p_keyword_id is null then
      raise exception using errcode = '22023', message = 'keyword id is required';
    end if;
    select * into v_keyword
    from public.keywords
    where id = p_keyword_id and owner_id = v_actor;
    if not found then
      raise exception using errcode = 'P0002', message = 'keyword not found';
    end if;
    v_content := p_content;
  end if;

  if v_content is null or jsonb_typeof(v_content) <> 'object' then
    raise exception using errcode = '22023', message = 'content must be an object';
  end if;
  if jsonb_typeof(v_content -> 'question_text') <> 'string'
     or jsonb_typeof(v_content -> 'model_answer') <> 'string'
     or jsonb_typeof(v_content -> 'choices') <> 'array'
     or (v_content ? 'explanation' and v_content -> 'explanation' <> 'null'::jsonb
         and jsonb_typeof(v_content -> 'explanation') <> 'string') then
    raise exception using errcode = '22023', message = 'invalid content fields';
  end if;

  v_question_text := btrim(v_content ->> 'question_text');
  v_model_answer := btrim(v_content ->> 'model_answer');
  v_choices := v_content -> 'choices';
  v_explanation := nullif(btrim(v_content ->> 'explanation'), '');
  if v_question_text = '' then
    raise exception using errcode = '23514', message = 'question_text is required';
  end if;
  if v_model_answer = '' then
    raise exception using errcode = '23514', message = 'model_answer is required';
  end if;

  v_normalized_answer := lower(translate(
    replace(v_model_answer, '　', ' '),
    '！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～',
    '!"#$%&''()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
  ));
  v_normalized_answer := btrim(v_normalized_answer);

  for v_choice in select value from jsonb_array_elements(v_choices)
  loop
    if jsonb_typeof(v_choice) <> 'string' then
      raise exception using errcode = '22023', message = 'choices must contain strings';
    end if;
    v_choice_text := btrim(v_choice #>> '{}');
    if v_choice_text = '' then
      raise exception using errcode = '23514', message = 'choice must not be blank';
    end if;
    v_normalized_choice := lower(translate(
      replace(v_choice_text, '　', ' '),
      '！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～',
      '!"#$%&''()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
    ));
    v_normalized_choice := btrim(v_normalized_choice);
    if v_normalized_choice = v_normalized_answer then
      raise exception using errcode = '23514', message = 'choice duplicates model_answer';
    end if;
    if v_normalized_choice = any(v_seen_choices) then
      raise exception using errcode = '23514', message = 'choices must be unique';
    end if;
    v_seen_choices := array_append(v_seen_choices, v_normalized_choice);
  end loop;

  -- Doubt note follows the resulting doubt flag: it is cleared whenever the
  -- flag ends up false and is kept unchanged unless explicitly patched.
  v_doubt_flag := case when v_patch ? 'doubt_flag'
    then (v_patch ->> 'doubt_flag')::boolean
    else coalesce(v_question.doubt_flag, false) end;
  if v_patch ? 'doubt_note' then
    v_doubt_note := nullif(btrim(v_patch ->> 'doubt_note'), '');
    if v_doubt_note is not null and not v_doubt_flag then
      raise exception using errcode = '22023', message = 'doubt note requires doubt flag';
    end if;
  else
    v_doubt_note := v_question.doubt_note;
  end if;
  if not v_doubt_flag then
    v_doubt_note := null;
  end if;
  if char_length(v_doubt_note) > 1000 then
    raise exception using errcode = '23514', message = 'doubt note is too long';
  end if;

  if v_question.id is null then
    insert into public.structured_questions (
      id, keyword_id, material_id, owner_id, question_text, model_answer,
      choices, explanation, doubt_flag, doubt_note, explanation_request_flag, is_active
    ) values (
      p_question_id, v_keyword.id, v_keyword.material_id, v_actor,
      v_question_text, v_model_answer, v_choices, v_explanation,
      v_doubt_flag,
      v_doubt_note,
      coalesce((v_patch ->> 'explanation_request_flag')::boolean, false),
      coalesce((v_patch ->> 'is_active')::boolean, true)
    ) returning * into v_question;
  else
    update public.structured_questions
    set question_text = v_question_text,
        model_answer = v_model_answer,
        choices = v_choices,
        explanation = v_explanation,
        doubt_flag = v_doubt_flag,
        doubt_note = v_doubt_note,
        explanation_request_flag = case when v_patch ? 'explanation_request_flag'
          then (v_patch ->> 'explanation_request_flag')::boolean
          else explanation_request_flag end,
        is_active = case when v_patch ? 'is_active'
          then (v_patch ->> 'is_active')::boolean else is_active end
    where id = p_question_id and version = p_expected_version
    returning * into v_question;
  end if;

  return jsonb_build_object('kind', 'saved', 'question', to_jsonb(v_question));
end;
$$;

create or replace function public.mutate_structured_question(
  p_command text,
  p_question_id uuid default null,
  p_keyword_id uuid default null,
  p_expected_version bigint default null,
  p_content jsonb default null,
  p_flag_patch jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_question_id uuid := coalesce(p_question_id, gen_random_uuid());
  v_patch jsonb;
begin
  if p_command not in ('create', 'update-content', 'set-flags', 'set-active', 'delete') then
    raise exception using errcode = '22023', message = 'unsupported question command';
  end if;
  if p_command = 'create' and p_question_id is not null then
    raise exception using errcode = '22023', message = 'create question id must be omitted';
  end if;
  if p_command <> 'create' and p_question_id is null then
    raise exception using errcode = '22023', message = 'question id is required';
  end if;
  if p_command <> 'create' and p_keyword_id is not null then
    raise exception using errcode = '22023', message = 'keyword id is only valid for create';
  end if;
  if p_command <> 'update-content' and p_command <> 'create' and p_content is not null then
    raise exception using errcode = '22023', message = 'content is not valid for this command';
  end if;
  if p_command <> 'set-flags' and p_command <> 'set-active' and p_flag_patch is not null then
    raise exception using errcode = '22023', message = 'flag patch is not valid for this command';
  end if;

  if p_command = 'create' then
    if p_keyword_id is null or p_content is null
       or (p_expected_version is not null and p_expected_version <> 0) then
      raise exception using errcode = '22023', message = 'invalid create input';
    end if;
    v_patch := jsonb_build_object('__create', true);
  elsif p_command = 'update-content' then
    if p_expected_version is null or p_content is null then
      raise exception using errcode = '22023', message = 'content and expected version are required';
    end if;
    v_patch := '{}'::jsonb;
  elsif p_command = 'set-flags' then
    if p_expected_version is null or jsonb_typeof(p_flag_patch) <> 'object'
       or not (p_flag_patch ? 'doubt_flag' or p_flag_patch ? 'explanation_request_flag')
       or exists (
         select 1 from jsonb_object_keys(p_flag_patch) as key
         where key not in ('doubt_flag', 'doubt_note', 'explanation_request_flag')
       )
       or (p_flag_patch ? 'doubt_flag'
           and jsonb_typeof(p_flag_patch -> 'doubt_flag') <> 'boolean')
       or (p_flag_patch ? 'explanation_request_flag'
           and jsonb_typeof(p_flag_patch -> 'explanation_request_flag') <> 'boolean')
       or (p_flag_patch ? 'doubt_note'
           and jsonb_typeof(p_flag_patch -> 'doubt_note') not in ('string', 'null')) then
      raise exception using errcode = '22023', message = 'invalid flag input';
    end if;
    v_patch := p_flag_patch;
  elsif p_command = 'set-active' then
    if p_expected_version is null or jsonb_typeof(p_flag_patch) <> 'object'
       or not (p_flag_patch ? 'is_active')
       or (select count(*) from jsonb_object_keys(p_flag_patch)) <> 1
       or jsonb_typeof(p_flag_patch -> 'is_active') <> 'boolean' then
      raise exception using errcode = '22023', message = 'invalid active input';
    end if;
    v_patch := jsonb_build_object('is_active', p_flag_patch -> 'is_active');
  elsif p_command = 'delete' then
    if p_expected_version is null then
      raise exception using errcode = '22023', message = 'expected version is required';
    end if;
    v_patch := jsonb_build_object('__delete', true);
  end if;

  return private.apply_structured_question_content(
    v_question_id, p_keyword_id, p_expected_version, p_content, v_patch
  );
end;
$$;

-- CREATE OR REPLACE keeps existing ACLs; reassert the least-privilege boundary.
revoke all on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)
  to authenticated;
revoke all on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb)
  to authenticated;
