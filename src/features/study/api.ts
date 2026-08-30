import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/paged';
import { scanKeywordTokens, parseKeywordToken } from '@/lib/keyword';
import type { ChapterRow } from '@/features/chapters/tree';
import { updateSrs, type SrsState } from './srs';
import type { AnswerFormat } from './question';

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

export type StudyChapter = ChapterRow & { materialId: string; body: string };

export type StudyKeyword = {
  id: string;
  docId: string;
  materialId: string;
  chapterId: string | null;
  answers: string[];
  tags: string[];
  wrongChoices: string[];
  isActive: boolean;
  stats: (SrsState & { totalCount: number; correctCount: number; dueAt: Date | null }) | null;
};

export type StudyData = {
  title: string;
  /** 中断したときに戻る先 */
  subjectId: string;
  chapters: StudyChapter[];
  keywords: StudyKeyword[];
};

/** 出題対象を集める（決定表「出題順」列7・列8）。 */
export async function loadStudyData(scope: {
  kind: 'subject' | 'material';
  id: string;
}): Promise<StudyData> {
  const materials =
    scope.kind === 'subject'
      ? await supabase.from('materials').select('id, name, subject_id').eq('subject_id', scope.id)
      : await supabase.from('materials').select('id, name, subject_id').eq('id', scope.id);
  if (materials.error) fail('教材の取得に失敗しました', materials.error);

  const materialIds = (materials.data ?? []).map((m) => m.id as string);
  const title =
    scope.kind === 'material'
      ? ((materials.data?.[0]?.name as string) ?? '')
      : await subjectName(scope.id);

  const subjectId =
    scope.kind === 'subject' ? scope.id : ((materials.data?.[0]?.subject_id as string) ?? '');

  if (materialIds.length === 0) return { title, subjectId, chapters: [], keywords: [] };

  const [chapters, keywords] = await Promise.all([
    supabase
      .from('chapters')
      .select('id, material_id, parent_id, title, body, sort_order')
      .in('material_id', materialIds)
      .order('sort_order'),
    // 行数上限で切られると、出題されないキーワードが出る（決定表「出題順」列16）
    fetchAll(async (from, to) => {
      const page = await supabase
        .from('keywords')
        .select(
          'id, doc_id, material_id, chapter_id, answers, tags, wrong_choices, is_active, keyword_stats(total_count, correct_count, repetition, ease_factor, interval_days, due_at)',
          { count: 'exact' },
        )
        .in('material_id', materialIds)
        // 分割して取るので、並びは一意に決まるものにする
        .order('doc_id')
        .order('id')
        .range(from, to);
      if (page.error) fail('キーワードの取得に失敗しました', page.error);
      return { rows: page.data ?? [], total: page.count };
    }),
  ]);
  if (chapters.error) fail('章の取得に失敗しました', chapters.error);

  return {
    title,
    subjectId,
    chapters: (chapters.data ?? []).map((c) => ({
      id: c.id,
      materialId: c.material_id,
      parentId: c.parent_id,
      title: c.title,
      sortOrder: c.sort_order,
      body: c.body ?? '',
    })),
    keywords: keywords.map((k) => {
      const stats = Array.isArray(k.keyword_stats) ? k.keyword_stats[0] : k.keyword_stats;
      return {
        id: k.id,
        docId: k.doc_id,
        materialId: k.material_id,
        chapterId: k.chapter_id,
        answers: k.answers ?? [],
        tags: k.tags ?? [],
        wrongChoices: k.wrong_choices ?? [],
        isActive: k.is_active,
        stats: stats
          ? {
              totalCount: stats.total_count,
              correctCount: stats.correct_count,
              repetition: stats.repetition,
              easeFactor: Number(stats.ease_factor),
              interval: Number(stats.interval_days),
              dueAt: stats.due_at ? new Date(stats.due_at) : null,
            }
          : null,
      };
    }),
  };
}

async function subjectName(subjectId: string): Promise<string> {
  const { data, error } = await supabase
    .from('subjects')
    .select('name')
    .eq('id', subjectId)
    .maybeSingle();
  if (error) fail('科目の取得に失敗しました', error);
  return data?.name ?? '';
}

/** 本文に出てくる doc_id を出現順に返す。出題順と表示範囲の組み立てに使う。 */
export function docIdsInBody(body: string): string[] {
  const ids: string[] = [];
  for (const token of scanKeywordTokens(body)) {
    const parsed = parseKeywordToken(token.inner);
    if (parsed?.docId) ids.push(parsed.docId);
  }
  return ids;
}

/**
 * 解答を1件記録する（決定表「正誤判定」列9・列10、「SRS の更新」）。
 * 履歴と学習状態は別の表なので、履歴を先に残す。
 */
export async function recordAnswer(input: {
  keywordId: string;
  format: AnswerFormat;
  input: string;
  correct: boolean;
  expanded: boolean;
  stats: StudyKeyword['stats'];
  now?: Date;
}): Promise<SrsState & { dueAt: Date }> {
  const { data: user } = await supabase.auth.getUser();
  const ownerId = user.user?.id;
  if (!ownerId) throw new Error('ログインしていません');

  const now = input.now ?? new Date();
  const next = updateSrs(
    input.stats
      ? {
          repetition: input.stats.repetition,
          interval: input.stats.interval,
          easeFactor: input.stats.easeFactor,
        }
      : null,
    { correct: input.correct, now, expanded: input.expanded },
  );

  const log = await supabase.from('answer_logs').insert({
    keyword_id: input.keywordId,
    owner_id: ownerId,
    format: input.format,
    input: input.input,
    is_correct: input.correct,
    expanded: input.expanded,
    answered_at: now.toISOString(),
  });
  if (log.error) fail('解答の記録に失敗しました', log.error);

  const stats = await supabase.from('keyword_stats').upsert(
    {
      keyword_id: input.keywordId,
      owner_id: ownerId,
      total_count: (input.stats?.totalCount ?? 0) + 1,
      correct_count: (input.stats?.correctCount ?? 0) + (input.correct ? 1 : 0),
      repetition: next.repetition,
      ease_factor: next.easeFactor,
      interval_days: next.interval,
      due_at: next.dueAt.toISOString(),
      last_answered_at: now.toISOString(),
    },
    { onConflict: 'keyword_id' },
  );
  if (stats.error) fail('学習状態の記録に失敗しました', stats.error);

  return next;
}

/**
 * 別解として登録する（決定表「別解の登録」列1・列4）。
 * その回の判定だけを正解に覆し、SRS を計算し直す。
 */
export async function registerAlternative(input: {
  keywordId: string;
  answers: string[];
  stats: StudyKeyword['stats'];
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();

  const keyword = await supabase
    .from('keywords')
    .update({ answers: input.answers })
    .eq('id', input.keywordId);
  if (keyword.error) fail('別解の登録に失敗しました', keyword.error);

  // その回の履歴だけを正解に直す
  const latest = await supabase
    .from('answer_logs')
    .select('id')
    .eq('keyword_id', input.keywordId)
    .order('answered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) fail('解答履歴の取得に失敗しました', latest.error);
  if (latest.data) {
    const log = await supabase
      .from('answer_logs')
      .update({ is_correct: true })
      .eq('id', latest.data.id);
    if (log.error) fail('解答履歴の更新に失敗しました', log.error);
  }

  // 直前の不正解を取り消して、正解として計算し直す
  const before = input.stats;
  const next = updateSrs(
    before
      ? { repetition: before.repetition, interval: before.interval, easeFactor: before.easeFactor }
      : null,
    { correct: true, now },
  );

  const stats = await supabase
    .from('keyword_stats')
    .update({
      correct_count: (before?.correctCount ?? 0) + 1,
      repetition: next.repetition,
      ease_factor: next.easeFactor,
      interval_days: next.interval,
      due_at: next.dueAt.toISOString(),
    })
    .eq('keyword_id', input.keywordId);
  if (stats.error) fail('学習状態の更新に失敗しました', stats.error);
}
