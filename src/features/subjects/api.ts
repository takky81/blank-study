import { supabase } from '@/lib/supabase';
import { normalizeName } from './validation';
import { fetchMaterialSummary } from '@/lib/summary';

export type Subject = {
  id: string;
  name: string;
  sortOrder: number;
  /** 配下の教材数 */
  materialCount: number;
  /** 配下の出題対象キーワード数 */
  keywordCount: number;
};

/** 削除の確認で見せる、消えるものの件数（決定表「科目の管理」列7）。 */
export type SubjectImpact = {
  materialCount: number;
  keywordCount: number;
  answerLogCount: number;
};

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

/**
 * 科目の一覧を、配下の件数つきで取得する。
 * 件数はサーバ側で数える（決定表「科目の管理」列13）。
 * キーワードの行を引いて手元で数えると、行数上限を超えたぶんを数え落とす。
 */
export async function listSubjects(): Promise<Subject[]> {
  const [subjects, summary] = await Promise.all([
    supabase.from('subjects').select('id, name, sort_order').order('sort_order'),
    fetchMaterialSummary(),
  ]);

  if (subjects.error) fail('科目の取得に失敗しました', subjects.error);

  const countsBySubject = new Map<string, { materials: number; keywords: number }>();
  for (const m of summary) {
    const current = countsBySubject.get(m.subjectId) ?? { materials: 0, keywords: 0 };
    current.materials += 1;
    current.keywords += m.keywordCount;
    countsBySubject.set(m.subjectId, current);
  }

  return (subjects.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    sortOrder: s.sort_order,
    materialCount: countsBySubject.get(s.id)?.materials ?? 0,
    keywordCount: countsBySubject.get(s.id)?.keywords ?? 0,
  }));
}

/** 科目を一覧の末尾に追加する（決定表「科目の管理」列1）。 */
export async function createSubject(name: string, currentCount: number): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user.user?.id;
  if (!ownerId) throw new Error('ログインしていません');

  const { error } = await supabase
    .from('subjects')
    .insert({ name: normalizeName(name), owner_id: ownerId, sort_order: currentCount });
  if (error) fail('科目の追加に失敗しました', error);
}

/** 科目名を変更する（列5）。 */
export async function renameSubject(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('subjects')
    .update({ name: normalizeName(name) })
    .eq('id', id);
  if (error) fail('科目名の変更に失敗しました', error);
}

/**
 * 削除で消えるものの件数を数える（列7）。
 * 解答履歴まで消えるため、件数を見せてから確認する。
 */
export async function countSubjectImpact(id: string): Promise<SubjectImpact> {
  const materials = await supabase.from('materials').select('id').eq('subject_id', id);
  if (materials.error) fail('教材の取得に失敗しました', materials.error);

  const materialIds = (materials.data ?? []).map((m) => m.id);
  if (materialIds.length === 0) {
    return { materialCount: 0, keywordCount: 0, answerLogCount: 0 };
  }

  // 件数はサーバ側で数える（決定表「科目の管理」列14）。
  // id を引いて並べると、行数上限で数え落とし、URL も長くなりすぎる。
  const [keywords, logs] = await Promise.all([
    supabase
      .from('keywords')
      .select('id', { count: 'exact', head: true })
      .in('material_id', materialIds),
    supabase
      .from('answer_logs')
      .select('id, keywords!inner(material_id)', { count: 'exact', head: true })
      .in('keywords.material_id', materialIds),
  ]);
  if (keywords.error) fail('キーワードの取得に失敗しました', keywords.error);
  if (logs.error) fail('解答履歴の取得に失敗しました', logs.error);

  return {
    materialCount: materialIds.length,
    keywordCount: keywords.count ?? 0,
    answerLogCount: logs.count ?? 0,
  };
}

/** 科目を消す。配下の教材・章・キーワード・解答履歴も消える（列8、仕様書 §3.7）。 */
export async function deleteSubject(id: string): Promise<void> {
  const { error } = await supabase.from('subjects').delete().eq('id', id);
  if (error) fail('科目の削除に失敗しました', error);
}

/** 並べ替えを保存する（列10）。 */
export async function saveSubjectOrder(orderedIds: readonly string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('subjects').update({ sort_order: index }).eq('id', id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) fail('並べ替えの保存に失敗しました', failed.error);
}
