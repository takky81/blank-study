-- 出題対象の同期を1回の更新で行う
-- 決定表「保存と正規化」列3・列4・列12
--
-- 本文に出てこなくなったキーワードは、レコードと解答履歴を残したまま
-- 出題対象から外す。以前はクライアントで差分を求め、1件ずつ更新していた。
-- 教材が大きいと更新の数だけ往復が発生するため、更新そのものをここに置く。
--
-- 本文に今ある doc_id を受け取り、その集合に入るかどうかで is_active を決める。
-- security invoker のままにして、更新できる行は RLS に任せる。

create or replace function public.sync_active_keywords(
  p_material_id uuid,
  p_doc_ids     text[]
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_present text[] := coalesce(p_doc_ids, array[]::text[]);
  v_changed integer;
begin
  update public.keywords k
  set is_active = (k.doc_id = any(v_present))
  where k.material_id = p_material_id
    -- 変わらない行は触らない。更新のたびに走るトリガの空振りを避ける
    and k.is_active is distinct from (k.doc_id = any(v_present));

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

comment on function public.sync_active_keywords is
  '本文に出てくる doc_id の集合に合わせて、教材のキーワードの is_active を一括で揃える。';

revoke all on function public.sync_active_keywords(uuid, text[]) from public;
grant execute on function public.sync_active_keywords(uuid, text[]) to authenticated, service_role;
