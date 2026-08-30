import { supabase } from '@/lib/supabase';
import { normalizeName } from '@/features/subjects/validation';
import { fetchMaterialSummary } from '@/lib/summary';

export type Material = {
  id: string;
  name: string;
  sortOrder: number;
  chapterCount: number;
  /** 出題対象のキーワード数 */
  keywordCount: number;
  /** 正答回数 ÷ 出題回数。1度も解いていなければ null */
  correctRate: number | null;
  /** 今日中に復習するもの。未出題も含める */
  dueToday: number;
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

  // 件数と解答実績はサーバ側で数える（決定表「教材の管理」列14）。
  // キーワードの行を引いて手元で数えると、行数上限を超えたぶんを数え落とす。
  const summary = new Map((await fetchMaterialSummary()).map((s) => [s.materialId, s]));

  return (materials.data ?? []).map((m) => {
    const stats = summary.get(m.id);
    return {
      id: m.id,
      name: m.name,
      sortOrder: m.sort_order,
      chapterCount: stats?.chapterCount ?? 0,
      keywordCount: stats?.keywordCount ?? 0,
      correctRate: stats && stats.totalCount > 0 ? stats.correctCount / stats.totalCount : null,
      dueToday: stats?.dueCount ?? 0,
    };
  });
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
  // 件数はサーバ側で数える（列14）。id を引いて並べると、
  // 行数上限で数え落とし、URL も長くなりすぎる。
  const [chapters, keywords, logs] = await Promise.all([
    supabase.from('chapters').select('id', { count: 'exact', head: true }).eq('material_id', id),
    supabase.from('keywords').select('id', { count: 'exact', head: true }).eq('material_id', id),
    supabase
      .from('answer_logs')
      .select('id, keywords!inner(material_id)', { count: 'exact', head: true })
      .eq('keywords.material_id', id),
  ]);
  if (chapters.error) fail('章の取得に失敗しました', chapters.error);
  if (keywords.error) fail('キーワードの取得に失敗しました', keywords.error);
  if (logs.error) fail('解答履歴の取得に失敗しました', logs.error);

  return {
    chapterCount: chapters.count ?? 0,
    keywordCount: keywords.count ?? 0,
    answerLogCount: logs.count ?? 0,
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
