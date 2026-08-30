-- 一覧に出す集計をサーバ側で行う
-- 決定表「科目の管理」列13、「教材の管理」列14
--
-- 教材ごとの章数・キーワード数・正答率・今日までの復習数を、まとめて1行で返す。
-- クライアントで全件を引いて数えると、1リクエストの行数上限（仕様書 §5.2）に
-- 当たって数え落とすため、数える処理そのものをここに置く。
--
-- 「今日まで」の境目は利用者の時間帯で決まるので、引数で受け取る。
-- security invoker のままにして、見える行は RLS に任せる。

create or replace function public.material_summary(p_due_before timestamptz)
returns table (
  material_id   uuid,
  subject_id    uuid,
  chapter_count bigint,
  keyword_count bigint,
  total_count   bigint,
  correct_count bigint,
  due_count     bigint
)
language sql
stable
set search_path = ''
as $$
  select
    m.id,
    m.subject_id,
    (select count(*) from public.chapters c where c.material_id = m.id),
    count(k.id),
    coalesce(sum(s.total_count), 0),
    coalesce(sum(s.correct_count), 0),
    -- 未出題は期限切れと同じ扱いで数える。キーワードが無い教材で数えないよう k を見る
    count(*) filter (where k.id is not null and (s.due_at is null or s.due_at <= p_due_before))
  from public.materials m
  left join public.keywords k on k.material_id = m.id and k.is_active
  left join public.keyword_stats s on s.keyword_id = k.id
  group by m.id, m.subject_id;
$$;

comment on function public.material_summary is
  '教材ごとの章数・キーワード数・解答実績を数える。行数上限に左右されずに数えるための集計。';

revoke all on function public.material_summary(timestamptz) from public;
grant execute on function public.material_summary(timestamptz) to authenticated, service_role;
