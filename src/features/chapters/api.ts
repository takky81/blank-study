import { supabase } from '@/lib/supabase';
import { normalizeName } from '@/features/subjects/validation';
import { syncActiveKeywords } from '@/features/editor/api';
import { isDescendant, type ChapterRow } from './tree';

export type ChapterImpact = {
  chapterCount: number;
  keywordCount: number;
};

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

/** 教材の名前と、その教材が属する科目。見つからなければ null。 */
export type MaterialPlace = {
  name: string;
  subjectId: string;
  subjectName: string;
};

export async function getMaterialPlace(materialId: string): Promise<MaterialPlace | null> {
  const { data, error } = await supabase
    .from('materials')
    .select('name, subject_id, subjects(name)')
    .eq('id', materialId)
    .maybeSingle();
  if (error) fail('教材の取得に失敗しました', error);
  if (!data) return null;
  const subject = data.subjects as unknown as { name: string } | null;
  return {
    name: data.name,
    subjectId: data.subject_id,
    subjectName: subject?.name ?? '',
  };
}

export async function listChapters(materialId: string): Promise<ChapterRow[]> {
  const { data, error } = await supabase
    .from('chapters')
    .select('id, parent_id, title, sort_order')
    .eq('material_id', materialId)
    .order('sort_order');
  if (error) fail('章の取得に失敗しました', error);
  return (data ?? []).map((c) => ({
    id: c.id,
    parentId: c.parent_id,
    title: c.title,
    sortOrder: c.sort_order,
  }));
}

export async function getChapterBody(chapterId: string): Promise<string> {
  const { data, error } = await supabase
    .from('chapters')
    .select('body')
    .eq('id', chapterId)
    .single();
  if (error) fail('本文の取得に失敗しました', error);
  return data.body ?? '';
}

/** 章を追加する（列1・列2）。選んでいる章があればその下、無ければ最上位。 */
export async function createChapter(
  materialId: string,
  parentId: string | null,
  title: string,
  siblingCount: number,
): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user.user?.id;
  if (!ownerId) throw new Error('ログインしていません');

  const { error } = await supabase.from('chapters').insert({
    material_id: materialId,
    parent_id: parentId,
    owner_id: ownerId,
    title: normalizeName(title),
    sort_order: siblingCount,
  });
  if (error) fail('章の追加に失敗しました', error);
}

export async function renameChapter(id: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('chapters')
    .update({ title: normalizeName(title) })
    .eq('id', id);
  if (error) fail('章名の変更に失敗しました', error);
}

/** 自分と子孫の id を集める。削除の対象。 */
function selfAndDescendants(rows: readonly ChapterRow[], id: string): string[] {
  return [id, ...rows.filter((r) => isDescendant(rows, id, r.id)).map((r) => r.id)];
}

/** 削除で消える章と、出題対象から外れるキーワードの件数（列5）。 */
export async function countChapterImpact(
  materialId: string,
  chapterId: string,
): Promise<ChapterImpact> {
  const rows = await listChapters(materialId);
  const ids = selfAndDescendants(rows, chapterId);

  const { count, error } = await supabase
    .from('keywords')
    .select('id', { count: 'exact', head: true })
    .in('chapter_id', ids);
  if (error) fail('キーワードの取得に失敗しました', error);

  return { chapterCount: ids.length, keywordCount: count ?? 0 };
}

/**
 * 章を消す。配下の章もまとめて消える（列6）。
 * キーワードは chapter_id が null になって残り、本文から消えるので出題対象から外れる。
 */
export async function deleteChapter(materialId: string, chapterId: string): Promise<void> {
  const { error } = await supabase.from('chapters').delete().eq('id', chapterId);
  if (error) fail('章の削除に失敗しました', error);
  await syncActiveKeywords(materialId);
}

/** 並べ替えとネスト変更を保存する（列7・列8）。変わった行だけ更新する。 */
export async function saveChapterTree(
  before: readonly ChapterRow[],
  after: readonly ChapterRow[],
): Promise<void> {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const changed = after.filter((row) => {
    const prev = beforeById.get(row.id);
    return !prev || prev.parentId !== row.parentId || prev.sortOrder !== row.sortOrder;
  });

  const results = await Promise.all(
    changed.map((row) =>
      supabase
        .from('chapters')
        .update({ parent_id: row.parentId, sort_order: row.sortOrder })
        .eq('id', row.id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) fail('並べ替えの保存に失敗しました', failed.error);
}
