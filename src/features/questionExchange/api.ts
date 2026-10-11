import { fetchAll } from '@/lib/paged';
import { supabase } from '@/lib/supabase';
import { listQuestionsByMaterial } from '@/features/questions/api';
import type { StructuredQuestion } from '@/features/questions/types';
import { projectEligibilityExport, type ExchangeCatalog } from './projection';
import { REASON_ORDER, REQUEST_KIND_ORDER, serializeExchangeExport } from './schema';
import {
  EXCHANGE_SCHEMA_VERSION,
  type EligibilityFilter,
  type EligibilityReason,
  type EligibilityTarget,
  type QuestionExchangeExportV1,
  type RequestKind,
} from './types';

/** `in` フィルタ1回に渡すID数。URL長と行数上限の両方に収まるよう小さめに取る。 */
const ID_CHUNK_SIZE = 200;

const RPC_CONTEXT = '設問交換の抽出に失敗しました';
const READ_CONTEXT = '設問交換の対象内容を読み込めませんでした';

/** 対象0件はdownload可能なartifactと区別した空結果にする。 */
export type EligibilityExportResult =
  | { kind: 'export'; value: QuestionExchangeExportV1 }
  | { kind: 'empty'; filters: EligibilityFilter };

export type EligibilityExportDeps = Readonly<{
  createExchangeId: () => string;
  now: () => Date;
}>;

const defaultDeps: EligibilityExportDeps = {
  createExchangeId: () => crypto.randomUUID(),
  now: () => new Date(),
};

function contextError(context: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message
    : typeof cause === 'object' && cause !== null && 'message' in cause ? String(cause.message)
      : '原因不明';
  return new Error(`${context}: ${message}`, { cause });
}

// ---- RPC row mapping ----

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isId = (v: unknown): v is string => typeof v === 'string' && v !== '';

function enumList<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value) || !value.every((v) => allowed.includes(v as T))) return null;
  return value as T[];
}

function mapTarget(value: unknown): EligibilityTarget | null {
  if (!isRecord(value) || !isId(value.keywordId) || !isRecord(value.metrics)) return null;
  const { attempts, correct, wrong, accuracy, questionCount } = value.metrics;
  if (!isCount(attempts) || !isCount(correct) || !isCount(wrong) || !isCount(questionCount)) return null;
  if (!(accuracy === null || (typeof accuracy === 'number' && accuracy >= 0 && accuracy <= 1))) return null;
  const reasons = enumList<EligibilityReason>(value.reasons, REASON_ORDER);
  if (reasons === null || reasons.length === 0 || !Array.isArray(value.flaggedQuestions)) return null;
  const flaggedQuestions: { questionId: string; requestKinds: RequestKind[] }[] = [];
  for (const f of value.flaggedQuestions) {
    if (!isRecord(f) || !isId(f.questionId)) return null;
    const requestKinds = enumList<RequestKind>(f.requestKinds, REQUEST_KIND_ORDER);
    if (requestKinds === null || requestKinds.length === 0) return null;
    flaggedQuestions.push({ questionId: f.questionId, requestKinds });
  }
  return {
    keywordId: value.keywordId,
    metrics: { attempts, correct, wrong, accuracy, questionCount },
    reasons,
    flaggedQuestions,
  };
}

/** eligibility RPCの単一jsonb配列を厳格に検証してEligibilityTargetへ写像する。 */
export function mapEligibilityRpcResult(data: unknown): EligibilityTarget[] {
  if (!Array.isArray(data)) throw new Error('抽出結果の形式が不正です: 配列ではありません');
  const seen = new Set<string>();
  return data.map((item, index) => {
    const target = mapTarget(item);
    if (target === null) throw new Error(`抽出結果の形式が不正です: [${index}]`);
    if (seen.has(target.keywordId)) throw new Error(`抽出結果の形式が不正です: [${index}] keyword重複`);
    seen.add(target.keywordId);
    return target;
  });
}

// ---- auxiliary paged reads ----

async function readPagedIn<T>(table: string, columns: string, column: string, ids: readonly string[],
  order: readonly string[]): Promise<T[]> {
  const values = [...new Set(ids)].sort();
  const result: T[] = [];
  for (let start = 0; start < values.length; start += ID_CHUNK_SIZE) {
    const chunk = values.slice(start, start + ID_CHUNK_SIZE);
    result.push(...await fetchAll<T>(async (from, to) => {
      let query = supabase.from(table).select(columns, { count: 'exact' }).in(column, chunk);
      for (const c of order) query = query.order(c);
      const page = await query.range(from, to);
      if (page.error) throw page.error;
      return { rows: (page.data ?? []) as T[], total: page.count };
    }));
  }
  return result;
}

type KeywordRow = { id: string; material_id: string; doc_id: string; answers: string[] | null; is_active: boolean };
type MaterialRow = { id: string; subject_id: string; name: string; sort_order: number };
type SubjectRow = { id: string; name: string; sort_order: number };
type ChapterRow = { id: string; material_id: string; parent_id: string | null; title: string; sort_order: number; body: string | null };

async function loadCatalogAndQuestions(targets: readonly EligibilityTarget[]): Promise<{
  catalog: ExchangeCatalog;
  questions: StructuredQuestion[];
}> {
  const keywords = await readPagedIn<KeywordRow>('keywords', 'id, material_id, doc_id, answers, is_active', 'id',
    targets.map((t) => t.keywordId), ['id']);
  const materialIds = [...new Set(keywords.map((k) => k.material_id))].sort();
  const [materials, chapters] = await Promise.all([
    readPagedIn<MaterialRow>('materials', 'id, subject_id, name, sort_order', 'id', materialIds, ['id']),
    readPagedIn<ChapterRow>('chapters', 'id, material_id, parent_id, title, sort_order, body', 'material_id',
      materialIds, ['material_id', 'sort_order', 'id']),
  ]);
  const subjects = await readPagedIn<SubjectRow>('subjects', 'id, name, sort_order', 'id',
    materials.map((m) => m.subject_id), ['id']);
  const targetIds = new Set(targets.map((t) => t.keywordId));
  const questions: StructuredQuestion[] = [];
  for (const materialId of materialIds) {
    questions.push(...(await listQuestionsByMaterial(materialId))
      .filter((q) => q.isActive && targetIds.has(q.keywordId)));
  }
  return {
    catalog: {
      subjects: subjects.map((s) => ({ id: s.id, title: s.name, sortOrder: s.sort_order })),
      materials: materials.map((m) => ({ id: m.id, subjectId: m.subject_id, title: m.name, sortOrder: m.sort_order })),
      chapters: chapters.map((c) => ({
        id: c.id, materialId: c.material_id, parentId: c.parent_id, title: c.title, sortOrder: c.sort_order, body: c.body ?? '',
      })),
      keywords: keywords.map((k) => ({
        id: k.id, materialId: k.material_id, docId: k.doc_id, answers: k.answers ?? [], isActive: k.is_active,
      })),
    },
    questions,
  };
}

/**
 * 検証済みfilterでowner対象を抽出し、schema v1 exportを組み立てる。
 * 0件は空結果、RPC失敗・補助読取の途中失敗・不完全な参照は操作文脈付きErrorとし、部分値を返さない。
 */
export async function exportEligibleQuestions(
  filter: EligibilityFilter,
  deps: EligibilityExportDeps = defaultDeps,
): Promise<EligibilityExportResult> {
  let targets: EligibilityTarget[];
  try {
    const response = await supabase.rpc('get_question_exchange_candidates', {
      p_minimum_attempts: filter.minimumAttempts,
      p_maximum_accuracy: filter.maximumAccuracy,
      p_maximum_question_count: filter.maximumQuestionCount,
    });
    if (response.error) throw response.error;
    targets = mapEligibilityRpcResult(response.data);
  } catch (cause) {
    throw contextError(RPC_CONTEXT, cause);
  }
  const filters = { ...filter };
  if (targets.length === 0) return { kind: 'empty', filters };

  try {
    const { catalog, questions } = await loadCatalogAndQuestions(targets);
    const value = projectEligibilityExport({
      header: { schemaVersion: EXCHANGE_SCHEMA_VERSION, exchangeId: deps.createExchangeId(), exportedAt: deps.now().toISOString() },
      filters,
      targets,
      catalog,
      questions,
    });
    serializeExchangeExport(value);
    return { kind: 'export', value };
  } catch (cause) {
    throw contextError(READ_CONTEXT, cause);
  }
}
