-- 取り込みを1つのトランザクションで行う
-- 決定表「インポート時のキーワード突合」列9（途中で失敗したら何も変更しない）
--
-- 記述のIDの採番と本文の縮約はクライアントで済ませ、ここは書き込みだけを行う。
-- security invoker のままにして、行の見え方と書き込みの可否は RLS に任せる。

create or replace function public.import_material(
  p_subject_id      uuid,    -- 教材を新しく作るときの科目
  p_material_id     uuid,    -- 既存の教材に取り込むときの教材。新規なら null
  p_material_name   text,    -- 新規のときの教材名
  p_parent_id       uuid,    -- 章単位で取り込むときの親の章。最上位なら null
  p_chapters        jsonb,   -- [{ tempId, parentTempId, title, body, sortOrder }]
  p_keywords        jsonb    -- [{ docId, answers, tags, wrongChoices, chapterTempId }]
) returns uuid
language plpgsql
as $$
declare
  v_owner_id    uuid := (select auth.uid());
  v_material_id uuid := p_material_id;
  v_ids         jsonb := '{}'::jsonb;  -- tempId -> 実際の章のID
  v_chapter     jsonb;
  v_keyword     jsonb;
  v_parent      uuid;
  v_new_id      uuid;
begin
  if v_owner_id is null then
    raise exception 'ログインしていません';
  end if;

  if v_material_id is null then
    insert into public.materials (subject_id, owner_id, name, sort_order)
    values (
      p_subject_id,
      v_owner_id,
      p_material_name,
      coalesce(
        (select max(sort_order) + 1 from public.materials where subject_id = p_subject_id),
        0
      )
    )
    returning id into v_material_id;
  end if;

  -- 章は親が先に並んでいる前提で受け取る
  for v_chapter in select * from jsonb_array_elements(p_chapters)
  loop
    if v_chapter->>'parentTempId' is null then
      v_parent := p_parent_id;
    else
      v_parent := (v_ids->>(v_chapter->>'parentTempId'))::uuid;
    end if;

    insert into public.chapters (material_id, parent_id, owner_id, title, body, sort_order)
    values (
      v_material_id,
      v_parent,
      v_owner_id,
      v_chapter->>'title',
      coalesce(v_chapter->>'body', ''),
      (v_chapter->>'sortOrder')::int
    )
    returning id into v_new_id;

    v_ids := v_ids || jsonb_build_object(v_chapter->>'tempId', v_new_id::text);
  end loop;

  -- 同じ doc_id の既存キーワードは中身だけ入れ替える。解答履歴と SRS の状態は続く
  for v_keyword in select * from jsonb_array_elements(p_keywords)
  loop
    insert into public.keywords (
      material_id, chapter_id, owner_id, doc_id, answers, tags, wrong_choices, is_active
    )
    values (
      v_material_id,
      (v_ids->>(v_keyword->>'chapterTempId'))::uuid,
      v_owner_id,
      v_keyword->>'docId',
      array(select jsonb_array_elements_text(v_keyword->'answers')),
      array(select jsonb_array_elements_text(v_keyword->'tags')),
      array(select jsonb_array_elements_text(v_keyword->'wrongChoices')),
      true
    )
    on conflict (material_id, doc_id) do update
    set chapter_id    = excluded.chapter_id,
        answers       = excluded.answers,
        tags          = excluded.tags,
        wrong_choices = excluded.wrong_choices,
        is_active     = true;
  end loop;

  return v_material_id;
end;
$$;

comment on function public.import_material is
  '章とキーワードをまとめて取り込む。途中で失敗した場合は何も変更しない。';
