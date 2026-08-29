import { supabase } from '@/lib/supabase';
import { normalizeName } from './validation';

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
 * 件数は教材とキーワードをまとめて引いて手元で数える。
 * 科目ごとに問い合わせると件数ぶんの往復が発生するため。
 */
export async function listSubjects(): Promise<Subject[]> {
  const [subjects, materials, keywords] = await Promise.all([
    supabase.from('subjects').select('id, name, sort_order').order('sort_order'),
    supabase.from('materials').select('id, subject_id'),
    supabase.from('keywords').select('material_id').eq('is_active', true),
  ]);

  if (subjects.error) fail('科目の取得に失敗しました', subjects.error);
  if (materials.error) fail('教材の取得に失敗しました', materials.error);
  if (keywords.error) fail('キーワードの取得に失敗しました', keywords.error);

  const keywordsByMaterial = new Map<string, number>();
  for (const k of keywords.data ?? []) {
    keywordsByMaterial.set(k.material_id, (keywordsByMaterial.get(k.material_id) ?? 0) + 1);
  }

  const countsBySubject = new Map<string, { materials: number; keywords: number }>();
  for (const m of materials.data ?? []) {
    const current = countsBySubject.get(m.subject_id) ?? { materials: 0, keywords: 0 };
    current.materials += 1;
    current.keywords += keywordsByMaterial.get(m.id) ?? 0;
    countsBySubject.set(m.subject_id, current);
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

  const keywords = await supabase.from('keywords').select('id').in('material_id', materialIds);
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
    materialCount: materialIds.length,
    keywordCount: keywordIds.length,
    answerLogCount,
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
