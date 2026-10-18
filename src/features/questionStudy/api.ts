import { fetchAll } from '@/lib/paged';
import { supabase } from '@/lib/supabase';
import { buildTree, type ChapterNode } from '@/features/chapters/tree';
import { listQuestionsByMaterial } from '@/features/questions/api';
import { listSubjects } from '@/features/subjects/api';
import { listMaterials } from '@/features/materials/api';
import { listChapters } from '@/features/chapters/api';
import type { StructuredQuestion } from '@/features/questions/types';
import {
  projectQuestionCandidates,
  type CatalogHierarchy,
  type QuestionStudyCandidate,
  type QuestionStudyScope,
  type QuestionStudyStats,
} from './candidates';
import type { ResolvedQuestionMode } from './question';
import { aggregateKeywordQuestionStudy, type KeywordQuestionStudyAggregate } from './statsContract';

/** `in` フィルタ1回に渡すID数。URL長と行数上限の両方に収まるよう小さめに取る。 */
const ID_CHUNK_SIZE = 200;

const STATS_COLUMNS =
  'question_id, asked_count, correct_count, consecutive_correct, interval_days, ease_factor, due_at, updated_at';

type StatsRow = {
  question_id: string;
  asked_count: number;
  correct_count: number;
  consecutive_correct: number;
  interval_days: number;
  ease_factor: number | string;
  due_at: string | null;
  updated_at: string;
};

type SubjectRow = { id: string; sort_order: number; name: string };
type MaterialRow = { id: string; subject_id: string; sort_order: number; name: string };
type ChapterDbRow = {
  id: string; material_id: string; parent_id: string | null; sort_order: number; body: string | null; title: string;
};
type KeywordDbRow = {
  id: string; material_id: string; chapter_id: string | null; doc_id: string; is_active: boolean; answers: string[];
};

function readError(context: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message
    : typeof cause === 'object' && cause !== null && 'message' in cause ? String(cause.message)
      : '原因不明';
  return new Error(`${context}: ${message}`, { cause });
}

export function mapQuestionStudyStatsRow(row: StatsRow): QuestionStudyStats {
  return {
    questionId: row.question_id,
    askedCount: row.asked_count,
    correctCount: row.correct_count,
    consecutiveCorrect: row.consecutive_correct,
    intervalDays: row.interval_days,
    easeFactor: Number(row.ease_factor),
    dueAt: row.due_at,
    updatedAt: row.updated_at,
  };
}

/** 指定した設問の専用statsを、ID重複を除き question_id 順で全件取得する。 */
export async function listQuestionStudyStats(questionIds: readonly string[]): Promise<QuestionStudyStats[]> {
  const ids = [...new Set(questionIds)].sort();
  const rows: StatsRow[] = [];
  try {
    for (let start = 0; start < ids.length; start += ID_CHUNK_SIZE) {
      const chunk = ids.slice(start, start + ID_CHUNK_SIZE);
      rows.push(...await fetchAll<StatsRow>(async (from, to) => {
        const page = await supabase
          .from('structured_question_stats')
          .select(STATS_COLUMNS, { count: 'exact' })
          .in('question_id', chunk)
          .order('question_id')
          .range(from, to);
        if (page.error) throw page.error;
        return { rows: (page.data ?? []) as StatsRow[], total: page.count };
      }));
    }
  } catch (cause) {
    throw readError('設問学習の統計を読み込めませんでした', cause);
  }
  const seen = new Set<string>();
  return rows
    .filter((row) => (seen.has(row.question_id) ? false : (seen.add(row.question_id), true)))
    .map(mapQuestionStudyStatsRow);
}


type ActiveQuestionRow = { id: string; keyword_id: string; is_active: boolean };

/**
 * 下流consumer向け: 有効設問の専用statsをkeyword単位で集計して返す（読取のみ）。
 * materialIdを渡すとその教材に限定する。穴埋め統計は含まない。
 */
export async function listKeywordQuestionStudyAggregates(
  options: Readonly<{ materialId?: string }> = {},
): Promise<KeywordQuestionStudyAggregate[]> {
  let questions: ActiveQuestionRow[];
  try {
    questions = await fetchAll<ActiveQuestionRow>(async (from, to) => {
      let query = supabase
        .from('structured_questions')
        .select('id, keyword_id, is_active', { count: 'exact' })
        .eq('is_active', true);
      if (options.materialId !== undefined) query = query.eq('material_id', options.materialId);
      const page = await query.order('id').range(from, to);
      if (page.error) throw page.error;
      return { rows: (page.data ?? []) as ActiveQuestionRow[], total: page.count };
    });
  } catch (cause) {
    throw readError('設問学習の統計を読み込めませんでした', cause);
  }
  const stats = await listQuestionStudyStats(questions.map((row) => row.id));
  return aggregateKeywordQuestionStudy(
    questions.map((row) => ({ id: row.id, keywordId: row.keyword_id, isActive: row.is_active })),
    stats,
  );
}
/** 範囲の階層・有効設問・statsを全ページ読み、候補へ射影する。権限外／不在の範囲は空。 */
export async function loadQuestionStudyCandidates(
  scope: QuestionStudyScope,
): Promise<readonly QuestionStudyCandidate[]> {
  const context = '設問学習の候補を読み込めませんでした';
  let hierarchy: CatalogHierarchy;
  let questions: StructuredQuestion[];
  try {
    const loaded = await loadHierarchy(scope);
    if (loaded === null) return [];
    hierarchy = loaded;
    const materialIds = hierarchy.materials.map((material) => material.id);
    questions = [];
    for (const materialId of materialIds) {
      questions.push(...(await listQuestionsByMaterial(materialId)).filter((question) => question.isActive));
    }
  } catch (cause) {
    throw readError(context, cause);
  }
  let stats: QuestionStudyStats[];
  try {
    stats = await listQuestionStudyStats(questions.map((question) => question.id));
  } catch (cause) {
    throw readError(context, cause);
  }
  return projectQuestionCandidates(scope, hierarchy, questions, stats);
}

async function loadHierarchy(scope: QuestionStudyScope): Promise<CatalogHierarchy | null> {
  const materialRows = await resolveMaterials(scope);
  if (materialRows === null || materialRows.length === 0) return null;
  const subjectIds = [...new Set(materialRows.map((material) => material.subject_id))];
  const materialIds = materialRows.map((material) => material.id);

  const [subjects, chapters, keywords] = await Promise.all([
    readPaged<SubjectRow>('subjects', 'id, sort_order, name', ['sort_order', 'id'], ['id', subjectIds]),
    readPaged<ChapterDbRow>('chapters', 'id, material_id, parent_id, sort_order, body, title',
      ['material_id', 'sort_order', 'id'], ['material_id', materialIds]),
    readPaged<KeywordDbRow>('keywords', 'id, material_id, chapter_id, doc_id, is_active, answers',
      ['material_id', 'doc_id', 'id'], ['material_id', materialIds]),
  ]);
  if (subjects.length === 0) return null;

  return {
    subjects: subjects.map((subject) => ({ id: subject.id, sortOrder: subject.sort_order, title: subject.name })),
    materials: materialRows.map((material) => ({
      id: material.id, subjectId: material.subject_id, sortOrder: material.sort_order, title: material.name,
    })),
    chapters: preOrderChapters(chapters),
    keywords: keywords.map((keyword) => ({
      id: keyword.id, materialId: keyword.material_id, docId: keyword.doc_id, isActive: keyword.is_active,
      chapterId: keyword.chapter_id, answers: keyword.answers,
    })),
  };
}

async function resolveMaterials(scope: QuestionStudyScope): Promise<MaterialRow[] | null> {
  const columns = 'id, subject_id, sort_order, name';
  const order = ['sort_order', 'id'];
  if (scope.kind === 'subject') {
    return readPaged<MaterialRow>('materials', columns, order, null, ['subject_id', scope.id]);
  }
  let materialId = scope.id;
  if (scope.kind !== 'material') {
    const table = scope.kind === 'chapter' ? 'chapters' : 'keywords';
    const { data, error } = await supabase.from(table).select('material_id').eq('id', scope.id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    materialId = (data as { material_id: string }).material_id;
  }
  return readPaged<MaterialRow>('materials', columns, order, null, ['id', materialId]);
}

async function readPaged<T>(
  table: string,
  columns: string,
  order: readonly string[],
  inFilter: [string, readonly string[]] | null,
  eqFilter?: [string, string],
): Promise<T[]> {
  const run = (values: readonly string[] | null) => fetchAll<T>(async (from, to) => {
    let query = supabase.from(table).select(columns, { count: 'exact' });
    if (eqFilter) query = query.eq(eqFilter[0], eqFilter[1]);
    if (inFilter && values) query = query.in(inFilter[0], values);
    for (const column of order) query = query.order(column);
    const page = await query.range(from, to);
    if (page.error) throw page.error;
    return { rows: (page.data ?? []) as T[], total: page.count };
  });
  if (inFilter === null) return run(null);
  const values = [...new Set(inFilter[1])].sort();
  const result: T[] = [];
  for (let start = 0; start < values.length; start += ID_CHUNK_SIZE) {
    result.push(...await run(values.slice(start, start + ID_CHUNK_SIZE)));
  }
  return result;
}

/** 教材ごとに章木を pre-order へ展開し、その位置を sortOrder とする。 */
function preOrderChapters(rows: readonly ChapterDbRow[]): CatalogHierarchy['chapters'] {
  const byMaterial = new Map<string, ChapterDbRow[]>();
  for (const row of rows) {
    const list = byMaterial.get(row.material_id) ?? [];
    list.push(row);
    byMaterial.set(row.material_id, list);
  }
  const result: CatalogHierarchy['chapters'][number][] = [];
  for (const [materialId, list] of byMaterial) {
    const rowsById = new Map(list.map((row) => [row.id, row]));
    const tree = buildTree(list.map((row) => ({
      id: row.id, parentId: row.parent_id, title: '', sortOrder: row.sort_order,
    })));
    let index = 0;
    const visit = (nodes: readonly ChapterNode[]) => {
      for (const node of nodes) {
        const row = rowsById.get(node.id);
        result.push({
          id: node.id, materialId, sortOrder: index, body: row?.body ?? '', title: row?.title, parentId: row?.parent_id ?? null,
        });
        index += 1;
        visit(node.children);
      }
    };
    visit(tree);
  }
  return result;
}

export type RecordQuestionAnswerInput = {
  questionId: string;
  expectedQuestionVersion: number;
  answer: string;
  mode: ResolvedQuestionMode;
  answeredAt: string;
};

export type RecordQuestionAnswerResult =
  | { kind: 'recorded'; logId: string; stats: QuestionStudyStats }
  | { kind: 'question-conflict' }
  | { kind: 'failed'; message: string };

const RECORD_FAILED_MESSAGE = '回答を記録できませんでした';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatsRow(value: unknown, questionId: string): value is StatsRow {
  return isRecord(value)
    && value.question_id === questionId
    && typeof value.asked_count === 'number'
    && typeof value.correct_count === 'number'
    && typeof value.consecutive_correct === 'number'
    && typeof value.interval_days === 'number'
    && (typeof value.ease_factor === 'number' || typeof value.ease_factor === 'string')
    && Number.isFinite(Number(value.ease_factor))
    && (value.due_at === null || typeof value.due_at === 'string')
    && typeof value.updated_at === 'string';
}

/** 回答を原子的に記録する。成功時だけ確定log IDと最新statsを返し、失敗時はstatsを返さない。 */
export async function recordQuestionAnswer(input: RecordQuestionAnswerInput): Promise<RecordQuestionAnswerResult> {
  let data: unknown;
  try {
    const response = await supabase.rpc('record_structured_question_answer', {
      p_question_id: input.questionId,
      p_expected_question_version: input.expectedQuestionVersion,
      p_answer: input.answer,
      p_mode: input.mode,
      p_answered_at: input.answeredAt,
    });
    if (response.error) return { kind: 'failed', message: RECORD_FAILED_MESSAGE };
    data = response.data;
  } catch {
    return { kind: 'failed', message: RECORD_FAILED_MESSAGE };
  }
  if (!isRecord(data)) return { kind: 'failed', message: RECORD_FAILED_MESSAGE };
  if (data.kind === 'question-conflict') return { kind: 'question-conflict' };
  if (data.kind === 'recorded' && typeof data.logId === 'string' && data.logId !== ''
    && isStatsRow(data.stats, input.questionId)) {
    return { kind: 'recorded', logId: data.logId, stats: mapQuestionStudyStatsRow(data.stats) };
  }
  return { kind: 'failed', message: RECORD_FAILED_MESSAGE };
}

export type QuestionScopeOption = Readonly<{ id: string; label: string }>;

/** 範囲選択の候補を階層ごとに読む。科目→教材→章／キーワード。 */
export type QuestionScopeOptionsLoader = Readonly<{
  listSubjects: () => Promise<readonly QuestionScopeOption[]>;
  listMaterials: (subjectId: string) => Promise<readonly QuestionScopeOption[]>;
  listChapters: (materialId: string) => Promise<readonly QuestionScopeOption[]>;
  listKeywords: (materialId: string) => Promise<readonly QuestionScopeOption[]>;
}>;

type KeywordOptionRow = { id: string; answers: string[] | null; is_active: boolean };

export const questionScopeOptionsLoader: QuestionScopeOptionsLoader = {
  listSubjects: async () => (await listSubjects()).map((s) => ({ id: s.id, label: s.name })),
  listMaterials: async (subjectId) => (await listMaterials(subjectId)).map((m) => ({ id: m.id, label: m.name })),
  listChapters: async (materialId) => {
    const rows = await listChapters(materialId);
    const ordered: QuestionScopeOption[] = [];
    const visit = (nodes: readonly ChapterNode[], depth: number) => {
      for (const node of nodes) {
        ordered.push({ id: node.id, label: `${'　'.repeat(depth)}${node.title}` });
        visit(node.children, depth + 1);
      }
    };
    visit(buildTree(rows), 0);
    return ordered;
  },
  listKeywords: async (materialId) => {
    const rows = await readPaged<KeywordOptionRow>('keywords', 'id, answers, is_active',
      ['doc_id', 'id'], null, ['material_id', materialId]);
    return rows.filter((row) => row.is_active)
      .map((row) => ({ id: row.id, label: row.answers?.[0] ?? row.id }));
  },
};
