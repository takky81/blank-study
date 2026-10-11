-- Atomically record one structured-question answer and advance its dedicated SRS.

create or replace function public.record_structured_question_answer(
  p_question_id uuid,
  p_expected_question_version bigint,
  p_answer text,
  p_mode text,
  p_answered_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_question public.structured_questions%rowtype;
  v_stats public.structured_question_stats%rowtype;
  v_log_id uuid;
  v_normalized_answer text;
  v_normalized_model_answer text;
  v_is_correct boolean;
  v_current_consecutive_correct integer := 0;
  v_current_interval_days integer := 0;
  v_current_ease_factor numeric := 2.5;
  v_next_consecutive_correct integer;
  v_next_interval_days integer;
  v_next_ease_factor numeric;
  v_now timestamptz := clock_timestamp();
  v_due_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_question_id is null or p_expected_question_version is null then
    raise exception using errcode = '22023', message = 'question id and version are required';
  end if;
  if p_mode is null or p_mode not in ('choice', 'written') then
    raise exception using errcode = '22023', message = 'invalid answer mode';
  end if;
  if p_answer is null or p_answered_at is null then
    raise exception using errcode = '22023', message = 'answer and answered_at are required';
  end if;

  -- Locking the question serializes all answers for one SRS state. Missing,
  -- foreign, inactive and stale questions deliberately share one result.
  select * into v_question
  from public.structured_questions
  where id = p_question_id and owner_id = v_actor and is_active = true
  for update;

  if not found or v_question.version <> p_expected_question_version then
    return jsonb_build_object('kind', 'question-conflict');
  end if;

  -- Keep this byte-for-byte mapping aligned with src/lib/answer.ts and the
  -- structured-question mutation validation. U+FFE5 remains distinct from \.
  v_normalized_answer := lower(translate(
    replace(p_answer, '　', ' '),
    '！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～',
    '!"#$%&''()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
  ));
  v_normalized_answer := btrim(v_normalized_answer);
  v_normalized_model_answer := lower(translate(
    replace(v_question.model_answer, '　', ' '),
    '！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～',
    '!"#$%&''()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
  ));
  v_normalized_model_answer := btrim(v_normalized_model_answer);
  v_is_correct := v_normalized_answer <> ''
    and v_normalized_answer = v_normalized_model_answer;

  select * into v_stats
  from public.structured_question_stats
  where question_id = p_question_id and owner_id = v_actor
  for update;

  if found then
    v_current_consecutive_correct := v_stats.consecutive_correct;
    v_current_interval_days := v_stats.interval_days;
    v_current_ease_factor := v_stats.ease_factor;
  end if;

  if v_is_correct then
    v_next_consecutive_correct := v_current_consecutive_correct + 1;
    v_next_ease_factor := greatest(1.3, round(v_current_ease_factor + 0.1, 10));
    if v_next_consecutive_correct = 1 then
      v_next_interval_days := 1;
    elsif v_next_consecutive_correct = 2 then
      v_next_interval_days := 6;
    else
      v_next_interval_days := floor((v_current_interval_days * v_current_ease_factor) + 0.5);
    end if;
  else
    v_next_consecutive_correct := 0;
    v_next_interval_days := 1;
    v_next_ease_factor := greatest(1.3, round(v_current_ease_factor - 0.8, 10));
  end if;
  v_due_at := v_now + make_interval(days => v_next_interval_days);

  insert into public.structured_question_answer_logs (
    question_id, owner_id, question_version, answer, mode, is_correct, answered_at
  ) values (
    p_question_id, v_actor, v_question.version, p_answer, p_mode, v_is_correct, p_answered_at
  ) returning id into v_log_id;

  insert into public.structured_question_stats (
    question_id, owner_id, asked_count, correct_count, consecutive_correct,
    interval_days, ease_factor, due_at, updated_at
  ) values (
    p_question_id, v_actor, 1, case when v_is_correct then 1 else 0 end,
    v_next_consecutive_correct, v_next_interval_days, v_next_ease_factor,
    v_due_at, v_now
  )
  on conflict (question_id) do update
  set asked_count = public.structured_question_stats.asked_count + 1,
      correct_count = public.structured_question_stats.correct_count
        + case when v_is_correct then 1 else 0 end,
      consecutive_correct = v_next_consecutive_correct,
      interval_days = v_next_interval_days,
      ease_factor = v_next_ease_factor,
      due_at = v_due_at,
      updated_at = v_now
  returning * into v_stats;

  return jsonb_build_object('kind', 'recorded', 'logId', v_log_id, 'stats', to_jsonb(v_stats));
exception when others then
  -- PostgreSQL rolls back all statements executed by this function call.
  raise;
end;
$$;
