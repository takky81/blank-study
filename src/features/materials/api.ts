import { supabase } from '@/lib/supabase';
import { normalizeName } from '@/features/subjects/validation';

export type Material = {
  id: string;
  name: string;
  sortOrder: number;
  chapterCount: number;
  /** 出題対象のキーワード数 */
  keywordCount: number;
};

export type MaterialImpact = {
  chapterCount: number;
  keywordCount: number;
  answerLogCount: number;
};

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

export async function getSubjectName(subjectId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('subjects')
    .select('name')
    .eq('id', subjectId)
    .maybeSingle();
  if (error) fail('科目の取得に失敗しました', error);
  return data?.name ?? null;
}

/** 科目に属する教材を、章数とキーワード数つきで取得する。 */
export async function listMaterials(subjectId: string): Promise<Material[]> {
  const materials = await supabase
    .from('materials')
    .select('id, name, sort_order')
    .eq('subject_id', subjectId)
    .order('sort_order');
  if (materials.error) fail('教材の取得に失敗しました', materials.error);

  const ids = (materials.data ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  const [chapters, keywords] = await Promise.all([
    supabase.from('chapters').select('material_id').in('material_id', ids),
    supabase.from('keywords').select('material_id').in('material_id', ids).eq('is_active', true),
  ]);
  if (chapters.error) fail('章の取得に失敗しました', chapters.error);
  if (keywords.error) fail('キーワードの取得に失敗しました', keywords.error);

  const count = (rows: { material_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) map.set(row.material_id, (map.get(row.material_id) ?? 0) + 1);
    return map;
  };
  const chapterCounts = count(chapters.data);
  const keywordCounts = count(keywords.data);

  return (materials.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    sortOrder: m.sort_order,
    chapterCount: chapterCounts.get(m.id) ?? 0,
    keywordCount: keywordCounts.get(m.id) ?? 0,
  }));
}

/**
 * 教材を追加する（決定表「教材の管理」列1）。
 * あわせて最上位の章を1件作る（列4）。章が0件だと編集を始められないため。
 * 章の作成に失敗したら教材ごと取り消して、中途半端な状態を残さない。
 */
export async function createMaterial(
  subjectId: string,
  name: string,
  currentCount: number,
): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user.user?.id;
  if (!ownerId) throw new Error('ログインしていません');

  const trimmed = normalizeName(name);
  const created = await supabase
    .from('materials')
    .insert({ name: trimmed, subject_id: subjectId, owner_id: ownerId, sort_order: currentCount })
    .select('id')
    .single();
  if (created.error) fail('教材の追加に失敗しました', created.error);

  const chapter = await supabase
    .from('chapters')
    .insert({ material_id: created.data.id, owner_id: ownerId, title: trimmed, sort_order: 0 });
  if (chapter.error) {
    await supabase.from('materials').delete().eq('id', created.data.id);
    fail('教材の追加に失敗しました', chapter.error);
  }
}

export async function renameMaterial(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('materials')
    .update({ name: normalizeName(name) })
    .eq('id', id);
  if (error) fail('教材名の変更に失敗しました', error);
}

/** 削除で消えるものの件数を数える（列7）。 */
export async function countMaterialImpact(id: string): Promise<MaterialImpact> {
  const [chapters, keywords] = await Promise.all([
    supabase.from('chapters').select('id', { count: 'exact', head: true }).eq('material_id', id),
    supabase.from('keywords').select('id').eq('material_id', id),
  ]);
  if (chapters.error) fail('章の取得に失敗しました', chapters.error);
  if (keywords.error) fail('キーワードの取得に失敗しました', keywords.error);

  const keywordIds = (keywords.data ?? []).map((k) => k.id);
  let answerLogCount = 0;
  if (keywordIds.length > 0) {
    const logs = await supabase
      .from('answer_logs')
      .select('id', { count: 'exact', head: true })
      .in('keyword_id', keywordIds);
    if (logs.error) fail('解答履歴の取得に失敗しました', logs.error);
    answerLogCount = logs.count ?? 0;
  }

  return {
    chapterCount: chapters.count ?? 0,
    keywordCount: keywordIds.length,
    answerLogCount,
  };
}

/** 教材を消す。配下の章・キーワード・解答履歴も消える（列6、仕様書 §3.7）。 */
export async function deleteMaterial(id: string): Promise<void> {
  const { error } = await supabase.from('materials').delete().eq('id', id);
  if (error) fail('教材の削除に失敗しました', error);
}

/** 並べ替えを保存する（列8）。 */
export async function saveMaterialOrder(orderedIds: readonly string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('materials').update({ sort_order: index }).eq('id', id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) fail('並べ替えの保存に失敗しました', failed.error);
}
