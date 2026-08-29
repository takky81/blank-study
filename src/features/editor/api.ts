import { supabase } from '@/lib/supabase';
import { assignDocIds, collapseBody, formatKeyword, type KeywordFields } from '@/lib/body';
import { planSave } from './overwrite';
import type { Conflict } from '@/features/transfer/match';
import { scanKeywordTokens, parseKeywordToken } from '@/lib/keyword';

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
 * 章の保存は2段に分ける。決定表「保存と正規化」「保存時の上書き確認」に対応する。
 *
 * 1. prepareSave  記述にIDを配り、上書きしてよいものと確認が要るものに分ける
 * 2. commitSave   keywords に反映し、chapters.body は保存形式にして持つ
 *                 そのあと教材の中で本文に出てこなくなったキーワードを非活性にする
 */
export type SavePreparation = {
  /** IDを配ったあとの展開形式 */
  body: string;
  apply: { docId: string; fields: KeywordFields }[];
  conflicts: Conflict[];
  existing: Map<string, KeywordFields>;
};

/**
 * 保存する内容を調べる。書き込みはまだしない。
 * 登録済みと食い違うキーワードは確認に回す（決定表「保存時の上書き確認」）。
 */
export async function prepareSave(
  materialId: string,
  expandedBody: string,
  trusted: ReadonlySet<string>,
): Promise<SavePreparation> {
  const rows = await listKeywords(materialId);
  const existing = new Map<string, KeywordFields>(
    rows.map((k) => [k.docId, { answers: k.answers, tags: k.tags, wrongChoices: k.wrongChoices }]),
  );

  const { body, keywords } = assignDocIds(
    expandedBody,
    rows.map((k) => k.docId),
  );
  const plan = planSave(keywords, existing, trusted);

  return {
    body,
    apply: plan.apply
      .filter((p): p is typeof p & { docId: string } => p.docId !== null)
      .map((p) => ({ docId: p.docId, fields: p.fields })),
    conflicts: plan.conflicts,
    existing,
  };
}

/**
 * 確認で「登録済みを残す」を選んだキーワードの記述を、DB の内容に戻す
 * （決定表「保存時の上書き確認」列5）。
 */
export function revertKeywords(
  body: string,
  docIds: readonly string[],
  existing: ReadonlyMap<string, KeywordFields>,
): string {
  const keep = new Set(docIds);
  const tokens = scanKeywordTokens(body);
  let result = body;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (!token) continue;
    const parsed = parseKeywordToken(token.inner);
    if (!parsed?.docId || !keep.has(parsed.docId)) continue;
    const fields = existing.get(parsed.docId);
    if (!fields) continue;
    result =
      result.slice(0, token.start) +
      formatKeyword({ ...fields, docId: parsed.docId }) +
      result.slice(token.end);
  }
  return result;
}

/** 調べた結果を書き込む。 */
export async function commitSave(
  materialId: string,
  chapterId: string,
  preparation: SavePreparation,
  overwrite: readonly string[] = [],
): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user.user?.id;
  if (!ownerId) throw new Error('ログインしていません');

  const chosen = new Set(overwrite);
  const kept = preparation.conflicts.filter((c) => !chosen.has(c.docId)).map((c) => c.docId);
  const body = revertKeywords(preparation.body, kept, preparation.existing);

  const keywords = [
    ...preparation.apply,
    ...preparation.conflicts
      .filter((c) => chosen.has(c.docId))
      .map((c) => ({ docId: c.docId, fields: c.incoming })),
  ];

  if (keywords.length > 0) {
    const { error } = await supabase.from('keywords').upsert(
      keywords.map((k) => ({
        material_id: materialId,
        chapter_id: chapterId,
        owner_id: ownerId,
        doc_id: k.docId,
        answers: k.fields.answers,
        tags: k.fields.tags,
        wrong_choices: k.fields.wrongChoices,
        is_active: true,
      })),
      { onConflict: 'material_id,doc_id' },
    );
    if (error) fail('キーワードの保存に失敗しました', error);
  }

  const { error } = await supabase
    .from('chapters')
    .update({ body: collapseBody(body) })
    .eq('id', chapterId);
  if (error) fail('本文の保存に失敗しました', error);

  await syncActiveKeywords(materialId);
  return body;
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
