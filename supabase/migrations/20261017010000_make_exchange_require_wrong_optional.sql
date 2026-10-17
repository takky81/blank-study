-- 設問交換の抽出: 成績条件の「誤答1回以上」を任意化する。
-- p_require_wrong（既定true）がfalseなら誤答0（全問正解）の用語も成績条件の対象にする。
-- 出題回数0は従来どおり成績条件不成立。式はsrc/features/questionExchange/eligibility.tsと一致させる。
-- 引数を増やすため旧3引数版を削除し、4引数版へ置き換える。

drop function public.get_question_exchange_candidates(numeric, numeric, numeric);

create or replace function public.get_question_exchange_candidates(
  p_minimum_attempts numeric,
  p_maximum_accuracy numeric,
  p_maximum_question_count numeric,
  p_require_wrong boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_minimum_attempts is null or p_minimum_attempts < 0
     or p_minimum_attempts <> trunc(p_minimum_attempts) then
    raise exception 'invalid minimum_attempts' using errcode = '22023';
  end if;
  if p_maximum_accuracy is null or p_maximum_accuracy < 0 or p_maximum_accuracy > 1 then
    raise exception 'invalid maximum_accuracy' using errcode = '22023';
  end if;
  if p_maximum_question_count is null or p_maximum_question_count < 0
     or p_maximum_question_count <> trunc(p_maximum_question_count) then
    raise exception 'invalid maximum_question_count' using errcode = '22023';
  end if;
  if p_require_wrong is null then
    raise exception 'invalid require_wrong' using errcode = '22023';
  end if;

  with active_questions as (
    select q.id, q.keyword_id, q.doubt_flag, q.explanation_request_flag,
           coalesce(s.asked_count, 0)::bigint as asked_count,
           coalesce(s.correct_count, 0)::bigint as correct_count
    from public.structured_questions q
    left join public.structured_question_stats s
      on s.question_id = q.id and s.owner_id = q.owner_id
    where q.owner_id = v_owner
      and q.is_active
  ),
  keyword_totals as (
    select a.keyword_id,
           sum(a.asked_count)::bigint as attempts,
           sum(a.correct_count)::bigint as correct,
           count(*)::bigint as question_count,
           bool_or(a.doubt_flag) as any_doubt,
           bool_or(a.explanation_request_flag) as any_explanation,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'questionId', a.id,
                 'requestKinds',
                 case
                   when a.doubt_flag and a.explanation_request_flag
                     then jsonb_build_array('doubt', 'explanation-request')
                   when a.doubt_flag then jsonb_build_array('doubt')
                   else jsonb_build_array('explanation-request')
                 end
               ) order by a.id
             ) filter (where a.doubt_flag or a.explanation_request_flag),
             '[]'::jsonb
           ) as flagged_questions
    from active_questions a
    group by a.keyword_id
  ),
  evaluated as (
    select k.*,
           case when k.attempts > 0 then k.correct::double precision / k.attempts end as accuracy,
           (
             k.attempts > 0
             and (not p_require_wrong or k.attempts - k.correct >= 1)
             and k.attempts >= p_minimum_attempts
             and (k.correct::double precision / nullif(k.attempts, 0)) <= p_maximum_accuracy
             and k.question_count <= p_maximum_question_count
           ) as performance
    from keyword_totals k
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'keywordId', k.keyword_id,
        'metrics', jsonb_build_object(
          'attempts', k.attempts,
          'correct', k.correct,
          'wrong', k.attempts - k.correct,
          'accuracy', k.accuracy,
          'questionCount', k.question_count
        ),
        'reasons', to_jsonb(array_remove(array[
          case when k.any_doubt then 'doubt-flag' end,
          case when k.any_explanation then 'explanation-request-flag' end,
          case when k.performance then 'performance-and-count' end
        ], null)),
        'flaggedQuestions', k.flagged_questions
      ) order by k.keyword_id
    ),
    '[]'::jsonb
  )
  into v_result
  from evaluated k
  where k.any_doubt or k.any_explanation or k.performance;

  return v_result;
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; expose only the
-- authenticated browser entry point.
revoke all on function public.get_question_exchange_candidates(numeric, numeric, numeric, boolean)
  from public, anon, service_role;
grant execute on function public.get_question_exchange_candidates(numeric, numeric, numeric, boolean)
  to authenticated;
