import { fetchAll } from '@/lib/paged';
import { supabase } from '@/lib/supabase';
import type {
  DeleteQuestionResult,
  ConsumerFlagMutationResult,
  FlagMutationContract,
  MutationResult,
  QuestionDraft,
  QuestionFlagPatch,
  QuestionVersionToken,
  ReorderQuestionResult,
  StructuredQuestionReadContract,
  StructuredQuestionConsumerView,
  StructuredQuestion,
} from './types';

const QUESTION_COLUMNS =
  'id, owner_id, material_id, keyword_id, question_text, model_answer, choices, explanation, sort_order, is_active, doubt_flag, doubt_note, explanation_request_flag, version, created_at, updated_at';

type StructuredQuestionRow = {
  id: string;
  owner_id: string;
  material_id: string;
  keyword_id: string;
  question_text: string;
  model_answer: string;
  choices: string[];
  explanation: string | null;
  sort_order: number;
  is_active: boolean;
  doubt_flag: boolean;
  doubt_note?: string | null;
  explanation_request_flag: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export function mapStructuredQuestionRow(row: StructuredQuestionRow): StructuredQuestion {
  return {
    id: row.id,
    ownerId: row.owner_id,
    materialId: row.material_id,
    keywordId: row.keyword_id,
    questionText: row.question_text,
    modelAnswer: row.model_answer,
    choices: row.choices,
    explanation: row.explanation,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    doubtFlag: row.doubt_flag,
    doubtNote: row.doubt_note ?? null,
    explanationRequestFlag: row.explanation_request_flag,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export async function listQuestionsByKeyword(keywordId: string): Promise<StructuredQuestion[]> {
  return readQuestions('keyword_id', keywordId, ['sort_order', 'id']);
}

export async function listQuestionsByMaterial(materialId: string): Promise<StructuredQuestion[]> {
  return readQuestions('material_id', materialId, ['keyword_id', 'sort_order', 'id']);
}

async function readQuestions(
  filter: 'keyword_id' | 'material_id',
  id: string,
  order: readonly string[],
): Promise<StructuredQuestion[]> {
  const rows = await fetchAll<StructuredQuestionRow>(async (from, to) => {
    let query = supabase
      .from('structured_questions')
      .select(QUESTION_COLUMNS, { count: 'exact' })
      .eq(filter, id);
    for (const column of order) query = query.order(column);
    const page = await query.range(from, to);
    if (page.error) {
      throw new Error(`設問の取得に失敗しました: ${page.error.message}`);
    }
    return { rows: (page.data ?? []) as StructuredQuestionRow[], total: page.count };
  });
  try {
    return rows.map(parseStructuredQuestionRow);
  } catch (cause) {
    throw new Error('設問の取得に失敗しました', { cause });
  }
}

export async function saveQuestion(
  draft: QuestionDraft,
  id?: string,
  expectedVersion?: number,
): Promise<MutationResult> {
  return mutateQuestion('保存', {
    p_command: id === undefined ? 'create' : 'update-content',
    p_question_id: id ?? null,
    p_keyword_id: id === undefined ? draft.keywordId : null,
    p_expected_version: expectedVersion ?? null,
    p_content: {
      question_text: draft.questionText,
      model_answer: draft.modelAnswer,
      choices: [...draft.choices],
      explanation: draft.explanation,
    },
    p_flag_patch: null,
  });
}

export async function setQuestionFlags(
  id: string,
  expectedVersion: number,
  flags: QuestionFlagPatch,
): Promise<MutationResult> {
  const patch: Record<string, boolean | string | null> = {};
  if (flags.doubtFlag !== undefined) patch.doubt_flag = flags.doubtFlag;
  if (flags.doubtNote !== undefined) patch.doubt_note = flags.doubtNote;
  if (flags.explanationRequestFlag !== undefined) {
    patch.explanation_request_flag = flags.explanationRequestFlag;
  }
  return mutateQuestion('フラグ更新', mutationArgs('set-flags', id, expectedVersion, patch));
}

export async function setQuestionActive(
  id: string,
  expectedVersion: number,
  active: boolean,
): Promise<MutationResult> {
  return mutateQuestion(
    '有効状態更新',
    mutationArgs('set-active', id, expectedVersion, { is_active: active }),
  );
}

export async function reorderQuestions(
  keywordId: string,
  ordered: readonly QuestionVersionToken[],
): Promise<ReorderQuestionResult> {
  const data = await callRpc('並べ替え', 'reorder_structured_questions', {
    p_keyword_id: keywordId,
    p_ordered: ordered.map(({ id, version }) => ({ id, version })),
  });
  const conflict = parseConflict(data, '並べ替え');
  if (conflict) return conflict;
  if (!isRecord(data) || data.kind !== 'saved' || !Array.isArray(data.questions)) {
    throw operationError('並べ替え');
  }
  try {
    return data.questions.map(parseStructuredQuestionRow);
  } catch (cause) {
    throw operationError('並べ替え', cause);
  }
}

export async function deleteQuestion(
  id: string,
  expectedVersion: number,
): Promise<DeleteQuestionResult> {
  const data = await callRpc('削除', 'mutate_structured_question',
    mutationArgs('delete', id, expectedVersion, null));
  const conflict = parseConflict(data, '削除');
  if (conflict) return conflict;
  if (isRecord(data)
    && data.kind === 'deleted'
    && data.id === id
    && isPositiveInteger(data.version)
    && data.version === expectedVersion) return 'deleted';
  throw operationError('削除');
}

export const structuredQuestionReadContract: StructuredQuestionReadContract = {
  async listQuestionsByMaterial(materialId) {
    const questions = await listQuestionsByMaterial(materialId);
    return Object.freeze(questions.map(toConsumerView));
  },
};

export const flagMutationContract: FlagMutationContract = {
  async setQuestionFlags(id, expectedVersion, flags) {
    return toConsumerFlagMutationResult(await setQuestionFlags(id, expectedVersion, flags));
  },
};

function toConsumerFlagMutationResult(result: MutationResult): ConsumerFlagMutationResult {
  return result.kind === 'saved'
    ? Object.freeze({ kind: 'saved', question: toConsumerView(result.question) })
    : Object.freeze({ kind: 'version-conflict', current: toConsumerView(result.current) });
}

function toConsumerView(question: StructuredQuestion): StructuredQuestionConsumerView {
  return Object.freeze({
    id: question.id,
    materialId: question.materialId,
    keywordId: question.keywordId,
    questionText: question.questionText,
    modelAnswer: question.modelAnswer,
    choices: Object.freeze([...question.choices]),
    explanation: question.explanation,
    sortOrder: question.sortOrder,
    isActive: question.isActive,
    doubtFlag: question.doubtFlag,
    doubtNote: question.doubtNote,
    explanationRequestFlag: question.explanationRequestFlag,
    version: question.version,
    updatedAt: question.updatedAt,
  });
}

type Operation = '保存' | 'フラグ更新' | '有効状態更新' | '並べ替え' | '削除';

function mutationArgs(
  command: 'set-flags' | 'set-active' | 'delete',
  id: string,
  expectedVersion: number,
  flagPatch: Record<string, boolean | string | null> | null,
): Record<string, unknown> {
  return {
    p_command: command,
    p_question_id: id,
    p_keyword_id: null,
    p_expected_version: expectedVersion,
    p_content: null,
    p_flag_patch: flagPatch,
  };
}

async function mutateQuestion(
  operation: Extract<Operation, '保存' | 'フラグ更新' | '有効状態更新'>,
  args: Record<string, unknown>,
): Promise<MutationResult> {
  const data = await callRpc(operation, 'mutate_structured_question', args);
  const conflict = parseConflict(data, operation);
  if (conflict) return conflict;
  if (!isRecord(data) || data.kind !== 'saved') throw operationError(operation);
  try {
    return { kind: 'saved', question: parseStructuredQuestionRow(data.question) };
  } catch (cause) {
    throw operationError(operation, cause);
  }
}

async function callRpc(
  operation: Operation,
  name: 'mutate_structured_question' | 'reorder_structured_questions',
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    const response = await supabase.rpc(name, args);
    if (response.error) throw response.error;
    return response.data;
  } catch (cause) {
    if (cause instanceof Error && cause.message === `設問の${operation}に失敗しました`) throw cause;
    throw operationError(operation, cause);
  }
}

function operationError(operation: Operation, cause?: unknown): Error {
  return new Error(`設問の${operation}に失敗しました`, cause === undefined ? undefined : { cause });
}

function parseConflict(
  value: unknown,
  operation: Operation,
): { kind: 'version-conflict'; current: StructuredQuestion } | null {
  if (!isRecord(value) || value.kind !== 'version-conflict') return null;
  try {
    return { kind: 'version-conflict', current: parseStructuredQuestionRow(value.current) };
  } catch (cause) {
    throw operationError(operation, cause);
  }
}

function parseStructuredQuestionRow(value: unknown): StructuredQuestion {
  if (!isStructuredQuestionRow(value)) throw new TypeError('invalid structured question row');
  return mapStructuredQuestionRow(value);
}

function isStructuredQuestionRow(value: unknown): value is StructuredQuestionRow {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.owner_id === 'string'
    && typeof value.material_id === 'string'
    && typeof value.keyword_id === 'string'
    && typeof value.question_text === 'string'
    && typeof value.model_answer === 'string'
    && Array.isArray(value.choices)
    && value.choices.every((choice) => typeof choice === 'string')
    && (value.explanation === null || typeof value.explanation === 'string')
    && isNonNegativeInteger(value.sort_order)
    && typeof value.is_active === 'boolean'
    && typeof value.doubt_flag === 'boolean'
    && (value.doubt_note === undefined || value.doubt_note === null || typeof value.doubt_note === 'string')
    && typeof value.explanation_request_flag === 'boolean'
    && isPositiveInteger(value.version)
    && isTimestamp(value.created_at)
    && isTimestamp(value.updated_at);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const validCalendarDate = calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
  return validCalendarDate
    && Number(hourText) <= 23
    && Number(minuteText) <= 59
    && Number(secondText) <= 59
    && (offsetHourText === undefined || Number(offsetHourText) <= 23)
    && (offsetMinuteText === undefined || Number(offsetMinuteText) <= 59);
}
