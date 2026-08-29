import { supabase } from '@/lib/supabase';
import { normalizeName } from '@/features/subjects/validation';
import { scanKeywordTokens, parseKeywordToken } from '@/lib/keyword';
import { isDescendant, type ChapterRow } from './tree';

export type ChapterImpact = {
  chapterCount: number;
  keywordCount: number;
};

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

export async function getMaterialName(materialId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('materials')
    .select('name')
    .eq('id', materialId)
    .maybeSingle();
  if (error) fail('教材の取得に失敗しました', error);
  return data?.name ?? null;
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
 * 教材内のキーワードの is_active を本文から数え直す（仕様書 §6.4）。
 * どの本文にも出現しないキーワードは出題対象から外し、レコードと履歴は残す。
 */
export async function recomputeActiveKeywords(materialId: string): Promise<void> {
  const [chapters, keywords] = await Promise.all([
    supabase.from('chapters').select('body').eq('material_id', materialId),
    supabase.from('keywords').select('id, doc_id, is_active').eq('material_id', materialId),
  ]);
  if (chapters.error) fail('本文の取得に失敗しました', chapters.error);
  if (keywords.error) fail('キーワードの取得に失敗しました', keywords.error);

  const present = new Set<string>();
  for (const chapter of chapters.data ?? []) {
    for (const token of scanKeywordTokens(chapter.body ?? '')) {
      const parsed = parseKeywordToken(token.inner);
      if (parsed?.docId) present.add(parsed.docId);
    }
  }

  const updates = (keywords.data ?? [])
    .map((k) => ({ id: k.id, next: present.has(k.doc_id), current: k.is_active }))
    .filter((k) => k.next !== k.current);

  await Promise.all(
    updates.map((u) => supabase.from('keywords').update({ is_active: u.next }).eq('id', u.id)),
  );
}

/**
 * 章を消す。配下の章もまとめて消える（列6）。
 * キーワードは chapter_id が null になって残り、本文から消えるので出題対象から外れる。
 */
export async function deleteChapter(materialId: string, chapterId: string): Promise<void> {
  const { error } = await supabase.from('chapters').delete().eq('id', chapterId);
  if (error) fail('章の削除に失敗しました', error);
  await recomputeActiveKeywords(materialId);
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
