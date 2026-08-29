import { supabase } from '@/lib/supabase';
import { assignDocIds, collapseBody, type KeywordFields } from '@/lib/body';

export type KeywordRow = KeywordFields & { docId: string; isActive: boolean };

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

/** 教材のキーワードを引く。展開形式に戻すときと、空欄の表示に使う。 */
export async function listKeywords(materialId: string): Promise<KeywordRow[]> {
  const { data, error } = await supabase
    .from('keywords')
    .select('doc_id, answers, tags, wrong_choices, is_active')
    .eq('material_id', materialId);
  if (error) fail('キーワードの取得に失敗しました', error);
  return (data ?? []).map((k) => ({
    docId: k.doc_id,
    answers: k.answers ?? [],
    tags: k.tags ?? [],
    wrongChoices: k.wrong_choices ?? [],
    isActive: k.is_active,
  }));
}

/**
 * 章を保存する。決定表「保存と正規化」列1・列2・列3・列4・列9 に対応する。
 *
 * 1. 記述にIDを行き渡らせる（決定表「キーワードIDの採番」）
 * 2. フル形式で書かれた内容を keywords に反映する
 * 3. chapters.body は保存形式（IDのみ）にして持つ
 * 4. 教材の中で本文に出てこなくなったキーワードを非活性にする
 *
 * 戻り値はIDを書き足したあとの展開形式。画面はこれに差し替える。
 */
export async function saveChapter(
  materialId: string,
  chapterId: string,
  expandedBody: string,
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user.user?.id;
  if (!ownerId) throw new Error('ログインしていません');

  const existing = await listKeywords(materialId);
  const { body: withIds, keywords } = assignDocIds(
    expandedBody,
    existing.map((k) => k.docId),
  );

  if (keywords.length > 0) {
    const { error } = await supabase.from('keywords').upsert(
      keywords.map((k) => ({
        material_id: materialId,
        chapter_id: chapterId,
        owner_id: ownerId,
        doc_id: k.docId,
        answers: k.answers,
        tags: k.tags,
        wrong_choices: k.wrongChoices,
        is_active: true,
      })),
      { onConflict: 'material_id,doc_id' },
    );
    if (error) fail('キーワードの保存に失敗しました', error);
  }

  const { error } = await supabase
    .from('chapters')
    .update({ body: collapseBody(withIds) })
    .eq('id', chapterId);
  if (error) fail('本文の保存に失敗しました', error);

  await syncActiveKeywords(materialId);
  return withIds;
}

/**
 * 教材のすべての本文を見て is_active を合わせる（列3・列4）。
 * キーワードのレコードと解答履歴は消さず、出題対象から外すだけにする。
 */
export async function syncActiveKeywords(materialId: string): Promise<void> {
  const [chapters, keywords] = await Promise.all([
    supabase.from('chapters').select('body').eq('material_id', materialId),
    supabase.from('keywords').select('id, doc_id, is_active').eq('material_id', materialId),
  ]);
  if (chapters.error) fail('本文の取得に失敗しました', chapters.error);
  if (keywords.error) fail('キーワードの取得に失敗しました', keywords.error);

  const present = new Set<string>();
  for (const chapter of chapters.data ?? []) {
    for (const matched of String(chapter.body ?? '').matchAll(/\{\{id=([a-z0-9]{6})\}\}/g)) {
      present.add(matched[1] as string);
    }
  }

  const updates = (keywords.data ?? [])
    .map((k) => ({ id: k.id as string, next: present.has(k.doc_id), current: k.is_active }))
    .filter((k) => k.next !== k.current);

  await Promise.all(
    updates.map((u) => supabase.from('keywords').update({ is_active: u.next }).eq('id', u.id)),
  );
}
