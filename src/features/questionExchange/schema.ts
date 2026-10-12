import { DOUBT_REASON_CODES, type DoubtReason } from '@/features/questions/doubtReasons';
import type {
  ChapterContextV1,
  EligibilityReason,
  EligibilityTarget,
  ExchangeHeader,
  ExchangeParseResult,
  ExchangeSchemaError,
  ExportQuestion,
  QuestionContentDraft,
  QuestionExchangeExportV1,
  QuestionExchangeFilterV1,
  QuestionExchangeImportV1,
  QuestionExchangeTargetV1,
  RequestKind,
  UpdateOperation,
} from './types';

/** 列挙配列の定義順。export/importとも重複なくこの順で並べる。 */
export const REASON_ORDER: readonly EligibilityReason[] = ['doubt-flag', 'explanation-request-flag', 'performance-and-count'];
export const REQUEST_KIND_ORDER: readonly RequestKind[] = ['doubt', 'explanation-request'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

type JsonObject = Record<string, unknown>;

/** JSON path付きerrorを収集しながら値を検証する。 */
class Checker {
  readonly errors: ExchangeSchemaError[] = [];

  fail(path: string, message: string): void {
    // 必須member欠落と型違反を同じpathで二重に報告しない。
    if (!this.errors.some((error) => error.path === path)) this.errors.push({ path, message });
  }

  /** objectであること、必須memberが揃い追加memberがないことを検証する。 */
  object(value: unknown, path: string, keys: readonly string[], extraMessage?: (key: string) => string): value is JsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'objectである必要があります。');
      return false;
    }
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) this.fail(`${path}.${key}`, '必須項目がありません。');
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) this.fail(`${path}.${key}`, extraMessage?.(key) ?? 'schema v1で定義されていない項目です。');
    }
    return true;
  }

  string(value: unknown, path: string): value is string {
    if (typeof value === 'string') return true;
    this.fail(path, '文字列である必要があります。');
    return false;
  }

  nullableString(value: unknown, path: string): boolean {
    return value === null || this.string(value, path);
  }

  uuid(value: unknown, path: string): boolean {
    if (typeof value === 'string' && UUID_PATTERN.test(value)) return true;
    this.fail(path, 'UUID文字列である必要があります。');
    return false;
  }

  integer(value: unknown, path: string, minimum: number): boolean {
    if (typeof value === 'number' && Number.isInteger(value) && value >= minimum) return true;
    this.fail(path, `${minimum}以上の整数である必要があります。`);
    return false;
  }

  ratio(value: unknown, path: string): boolean {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return true;
    this.fail(path, '0以上1以下の数値である必要があります。');
    return false;
  }

  timestamp(value: unknown, path: string): boolean {
    if (typeof value === 'string' && UTC_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value))) return true;
    this.fail(path, 'RFC 3339形式のUTC日時である必要があります。');
    return false;
  }

  array(value: unknown, path: string, item: (element: unknown, path: string) => void): value is unknown[] {
    if (!Array.isArray(value)) {
      this.fail(path, '配列である必要があります（該当なしは[]）。');
      return false;
    }
    value.forEach((element, index) => item(element, `${path}[${index}]`));
    return true;
  }

  enumArray<T extends string>(value: unknown, path: string, order: readonly T[]): void {
    this.array(value, path, (element, elementPath) => {
      if (!order.includes(element as T)) this.fail(elementPath, `${order.join('、')}のいずれかである必要があります。`);
    });
  }
}

/** 定義順で重複がないことを検証する。 */
function checkEnumOrder<T extends string>(c: Checker, values: readonly T[], path: string, order: readonly T[]): void {
  for (let i = 1; i < values.length; i += 1) {
    if (order.indexOf(values[i] as T) <= order.indexOf(values[i - 1] as T)) c.fail(`${path}[${i}]`, '定義順かつ重複なしで並べてください。');
  }
}

function compareKeys(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as string | number;
    const y = b[i] as string | number;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** 各要素が前要素より厳密に大きい（安定一意順）ことを検証する。 */
function checkStrictOrder<T>(c: Checker, values: readonly T[], path: string, key: (value: T) => (string | number)[]): void {
  for (let i = 1; i < values.length; i += 1) {
    if (compareKeys(key(values[i - 1] as T), key(values[i] as T)) >= 0) c.fail(`${path}[${i}]`, '安定順（昇順・重複なし）で並べてください。');
  }
}

const chapterKey = (c: ChapterContextV1) => [
  c.subject.sortOrder,
  c.subject.id,
  c.material.sortOrder,
  c.material.id,
  c.chapter.sortOrder,
  c.chapter.id,
];
const questionKey = (q: Pick<ExportQuestion, 'sortOrder' | 'questionId'>) => [q.sortOrder, q.questionId];

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function checkHeader(c: Checker, value: JsonObject): void {
  if (value.schemaVersion !== 1) c.fail('$.schemaVersion', '対応しているschema版は1だけです。');
  c.uuid(value.exchangeId, '$.exchangeId');
  c.timestamp(value.exportedAt, '$.exportedAt');
}

function checkNode(c: Checker, value: unknown, path: string, withBody: boolean): void {
  const keys = withBody ? ['id', 'title', 'sortOrder', 'bodyMarkdown'] : ['id', 'title', 'sortOrder'];
  if (!c.object(value, path, keys)) return;
  c.uuid(value.id, `${path}.id`);
  c.string(value.title, `${path}.title`);
  c.integer(value.sortOrder, `${path}.sortOrder`, 0);
  if (withBody) c.string(value.bodyMarkdown, `${path}.bodyMarkdown`);
}

function checkExportQuestion(c: Checker, value: unknown, path: string): void {
  const keys = ['questionId', 'expectedVersion', 'sortOrder', 'questionText', 'modelAnswer', 'choices', 'explanation', 'doubtNote', 'doubtReasons', 'requestedFlags'];
  if (!c.object(value, path, keys)) return;
  c.uuid(value.questionId, `${path}.questionId`);
  c.integer(value.expectedVersion, `${path}.expectedVersion`, 1);
  c.integer(value.sortOrder, `${path}.sortOrder`, 0);
  c.string(value.questionText, `${path}.questionText`);
  c.string(value.modelAnswer, `${path}.modelAnswer`);
  c.array(value.choices, `${path}.choices`, (e, p) => c.string(e, p));
  c.nullableString(value.explanation, `${path}.explanation`);
  c.nullableString(value.doubtNote, `${path}.doubtNote`);
  c.enumArray(value.doubtReasons, `${path}.doubtReasons`, DOUBT_REASON_CODES);
  c.enumArray(value.requestedFlags, `${path}.requestedFlags`, REQUEST_KIND_ORDER);
}

function checkTargetStructure(c: Checker, value: unknown, path: string): void {
  const keys = ['keyword', 'metrics', 'reasons', 'chapterContexts', 'questions', 'flaggedQuestions'];
  if (!c.object(value, path, keys)) return;
  if (c.object(value.keyword, `${path}.keyword`, ['id', 'displayText', 'modelAnswer'])) {
    c.uuid(value.keyword.id, `${path}.keyword.id`);
    c.string(value.keyword.displayText, `${path}.keyword.displayText`);
    c.string(value.keyword.modelAnswer, `${path}.keyword.modelAnswer`);
  }
  const metricsPath = `${path}.metrics`;
  if (c.object(value.metrics, metricsPath, ['attempts', 'correct', 'wrong', 'accuracy', 'questionCount'])) {
    for (const key of ['attempts', 'correct', 'wrong', 'questionCount'] as const) {
      c.integer(value.metrics[key], `${metricsPath}.${key}`, 0);
    }
    if (value.metrics.accuracy !== null) c.ratio(value.metrics.accuracy, `${metricsPath}.accuracy`);
  }
  c.enumArray(value.reasons, `${path}.reasons`, REASON_ORDER);
  c.array(value.chapterContexts, `${path}.chapterContexts`, (e, p) => {
    if (!c.object(e, p, ['subject', 'material', 'chapter'])) return;
    checkNode(c, e.subject, `${p}.subject`, false);
    checkNode(c, e.material, `${p}.material`, false);
    checkNode(c, e.chapter, `${p}.chapter`, true);
  });
  c.array(value.questions, `${path}.questions`, (e, p) => checkExportQuestion(c, e, p));
  c.array(value.flaggedQuestions, `${path}.flaggedQuestions`, (e, p) => {
    if (!c.object(e, p, ['questionId', 'requestKinds'])) return;
    c.uuid(e.questionId, `${p}.questionId`);
    c.enumArray(e.requestKinds, `${p}.requestKinds`, REQUEST_KIND_ORDER);
  });
}

/** 構造が正しいtargetについて、安定順と requestedFlags ↔ flaggedQuestions の一致を検証する。 */
function checkTargetSemantics(c: Checker, target: QuestionExchangeTargetV1, path: string): void {
  checkEnumOrder(c, target.reasons, `${path}.reasons`, REASON_ORDER);
  checkStrictOrder(c, target.chapterContexts, `${path}.chapterContexts`, chapterKey);
  checkStrictOrder(c, target.questions, `${path}.questions`, questionKey);
  target.questions.forEach((q, i) => checkEnumOrder(c, q.doubtReasons as DoubtReason[], `${path}.questions[${i}].doubtReasons`, DOUBT_REASON_CODES));
  target.questions.forEach((q, i) => checkEnumOrder(c, q.requestedFlags, `${path}.questions[${i}].requestedFlags`, REQUEST_KIND_ORDER));
  checkStrictOrder(c, target.flaggedQuestions, `${path}.flaggedQuestions`, (f) => [f.questionId]);
  target.flaggedQuestions.forEach((f, i) =>
    checkEnumOrder(c, f.requestKinds, `${path}.flaggedQuestions[${i}].requestKinds`, REQUEST_KIND_ORDER),
  );

  const kindsById = new Map(target.flaggedQuestions.map((f) => [f.questionId, f.requestKinds]));
  target.questions.forEach((q, i) => {
    if (!sameList(q.requestedFlags, kindsById.get(q.questionId) ?? [])) {
      c.fail(`${path}.questions[${i}].requestedFlags`, '同じ設問のflaggedQuestions.requestKindsと一致する必要があります。');
    }
  });
  const questionIds = new Set(target.questions.map((q) => q.questionId));
  target.flaggedQuestions.forEach((f, i) => {
    if (!questionIds.has(f.questionId)) c.fail(`${path}.flaggedQuestions[${i}].questionId`, '同じtargetのquestionsに存在しない設問です。');
  });
}

function validateExport(value: unknown): readonly ExchangeSchemaError[] {
  const c = new Checker();
  if (!c.object(value, '$', ['schemaVersion', 'exchangeId', 'exportedAt', 'filters', 'targets'])) return c.errors;
  checkHeader(c, value);
  if (c.object(value.filters, '$.filters', ['minimumAttempts', 'maximumAccuracy', 'maximumQuestionCount'])) {
    c.integer(value.filters.minimumAttempts, '$.filters.minimumAttempts', 0);
    c.ratio(value.filters.maximumAccuracy, '$.filters.maximumAccuracy');
    c.integer(value.filters.maximumQuestionCount, '$.filters.maximumQuestionCount', 0);
  }
  c.array(value.targets, '$.targets', (e, p) => checkTargetStructure(c, e, p));
  if (c.errors.length > 0) return c.errors;

  const exported = value as QuestionExchangeExportV1;
  checkStrictOrder(c, exported.targets, '$.targets', (t) => [t.keyword.id]);
  exported.targets.forEach((t, i) => checkTargetSemantics(c, t, `$.targets[${i}]`));
  return c.errors;
}

function checkContentDraft(c: Checker, value: unknown, path: string): void {
  const keys = ['questionText', 'modelAnswer', 'choices', 'explanation'];
  const extra = (key: string) =>
    key === 'keywordId' ? 'keywordIdはoperation側だけに指定してください。' : 'schema v1で定義されていない項目です。';
  if (!c.object(value, path, keys, extra)) return;
  c.string(value.questionText, `${path}.questionText`);
  c.string(value.modelAnswer, `${path}.modelAnswer`);
  c.array(value.choices, `${path}.choices`, (e, p) => c.string(e, p));
  c.nullableString(value.explanation, `${path}.explanation`);
}

function checkOperation(c: Checker, value: unknown, path: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    c.fail(path, 'objectである必要があります。');
    return;
  }
  const kind = (value as JsonObject).kind;
  if (kind === 'create') {
    const extra = (key: string) =>
      key === 'questionId' || key === 'expectedVersion'
        ? '新規追加(create)には設問IDや版を含められません。'
        : 'schema v1で定義されていない項目です。';
    if (!c.object(value, path, ['kind', 'keywordId', 'question'], extra)) return;
    c.uuid(value.keywordId, `${path}.keywordId`);
    checkContentDraft(c, value.question, `${path}.question`);
    return;
  }
  if (kind === 'update') {
    const keys = ['kind', 'keywordId', 'questionId', 'expectedVersion', 'question', 'sourceRequestedFlags', 'resolvedFlags'];
    if (!c.object(value, path, keys)) return;
    c.uuid(value.keywordId, `${path}.keywordId`);
    if ('questionId' in value) c.uuid(value.questionId, `${path}.questionId`);
    if ('expectedVersion' in value) c.integer(value.expectedVersion, `${path}.expectedVersion`, 1);
    if ('question' in value) checkContentDraft(c, value.question, `${path}.question`);
    if ('sourceRequestedFlags' in value) c.enumArray(value.sourceRequestedFlags, `${path}.sourceRequestedFlags`, REQUEST_KIND_ORDER);
    if ('resolvedFlags' in value) c.enumArray(value.resolvedFlags, `${path}.resolvedFlags`, REQUEST_KIND_ORDER);
    return;
  }
  if (kind === 'delete') {
    c.fail(`${path}.kind`, '削除命令には対応していません。');
    return;
  }
  c.fail(`${path}.kind`, '未対応の操作です（createまたはupdateだけを指定できます）。');
}

function validateImport(value: unknown): readonly ExchangeSchemaError[] {
  const c = new Checker();
  if (!c.object(value, '$', ['schemaVersion', 'exchangeId', 'exportedAt', 'operations'])) return c.errors;
  checkHeader(c, value);
  c.array(value.operations, '$.operations', (e, p) => checkOperation(c, e, p));
  return c.errors;
}

/** UTF-8のバイト列または文字列をJSONとして読み取る。 */
function decodeJson(input: string | Uint8Array): { ok: true; value: unknown } | { ok: false; errors: ExchangeSchemaError[] } {
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      return { ok: false, errors: [{ path: '$', message: 'UTF-8として読み取れないファイルです。' }] };
    }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, errors: [{ path: '$', message: 'JSONとして解析できません。' }] };
  }
}

function parseWith<T>(input: string | Uint8Array, validate: (value: unknown) => readonly ExchangeSchemaError[]): ExchangeParseResult<T> {
  const decoded = decodeJson(input);
  if (!decoded.ok) return decoded;
  const errors = validate(decoded.value);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: decoded.value as T };
}

export function parseExchangeExport(input: string | Uint8Array): ExchangeParseResult<QuestionExchangeExportV1> {
  return parseWith(input, validateExport);
}

export function parseExchangeImport(input: string | Uint8Array): ExchangeParseResult<QuestionExchangeImportV1> {
  return parseWith(input, validateImport);
}

function serializeValid(value: unknown, validate: (value: unknown) => readonly ExchangeSchemaError[]): string {
  const errors = validate(value);
  if (errors.length > 0) {
    throw new Error(`Invalid exchange JSON: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** schema v1として妥当なexportだけをJSON文字列化する（Blob化でUTF-8になる）。 */
export function serializeExchangeExport(value: QuestionExchangeExportV1): string {
  return serializeValid(value, validateExport);
}

export function serializeExchangeImport(value: QuestionExchangeImportV1): string {
  return serializeValid(value, validateImport);
}

const sortEnum = <T extends string>(values: readonly T[], order: readonly T[]): T[] =>
  [...new Set(values)].sort((a, b) => order.indexOf(a) - order.indexOf(b));

export type ExchangeTargetContext = {
  keyword: { displayText: string; modelAnswer: string };
  chapterContexts: readonly ChapterContextV1[];
  /** keywordの全active設問（requestedFlagsはflaggedQuestionsから導出する）。 */
  questions: readonly Omit<ExportQuestion, 'requestedFlags'>[];
};

/**
 * EligibilityTargetを同一keywordのexport targetへ欠落なく写像する。
 * requestedFlagsは同じquestionのflaggedQuestions.requestKindsと一致させ、非対象は[]とする。
 */
export function toExchangeTarget(target: EligibilityTarget, context: ExchangeTargetContext): QuestionExchangeTargetV1 {
  const flaggedQuestions = [...target.flaggedQuestions]
    .map((f) => ({ questionId: f.questionId, requestKinds: sortEnum(f.requestKinds, REQUEST_KIND_ORDER) }))
    .sort((a, b) => compareKeys([a.questionId], [b.questionId]));
  const kindsById = new Map(flaggedQuestions.map((f) => [f.questionId, f.requestKinds]));
  const questionIds = new Set(context.questions.map((q) => q.questionId));
  const missing = flaggedQuestions.filter((f) => !questionIds.has(f.questionId));
  if (missing.length > 0) {
    throw new Error(`Flagged questions not in keyword ${target.keywordId}: ${missing.map((f) => f.questionId).join(', ')}`);
  }

  return {
    keyword: { id: target.keywordId, ...context.keyword },
    metrics: { ...target.metrics },
    reasons: sortEnum(target.reasons, REASON_ORDER),
    chapterContexts: [...context.chapterContexts].sort((a, b) => compareKeys(chapterKey(a), chapterKey(b))),
    questions: [...context.questions]
      .sort((a, b) => compareKeys(questionKey(a), questionKey(b)))
      .map((q) => ({ ...q, requestedFlags: [...(kindsById.get(q.questionId) ?? [])] })),
    flaggedQuestions,
  };
}

/** targetをkeyword ID順に整えたexport envelopeを組み立てる。 */
export function buildExchangeExport(
  header: ExchangeHeader,
  filters: QuestionExchangeFilterV1,
  targets: readonly QuestionExchangeTargetV1[],
): QuestionExchangeExportV1 {
  return {
    schemaVersion: header.schemaVersion,
    exchangeId: header.exchangeId,
    exportedAt: header.exportedAt,
    filters: { ...filters },
    targets: [...targets].sort((a, b) => compareKeys([a.keyword.id], [b.keyword.id])),
  };
}

/**
 * exportした設問のupdate operationを作る。requestedFlagsを順序も含めて不変複製し、
 * その部分集合だけをresolvedFlagsとして受け付ける。
 */
export function createUpdateOperation(
  keywordId: string,
  exported: ExportQuestion,
  question: QuestionContentDraft,
  resolvedFlags: readonly RequestKind[],
): UpdateOperation {
  const outside = resolvedFlags.filter((flag) => !exported.requestedFlags.includes(flag));
  if (outside.length > 0) throw new Error(`resolvedFlags must be a subset of requestedFlags: ${outside.join(', ')}`);
  return {
    kind: 'update',
    keywordId,
    questionId: exported.questionId,
    expectedVersion: exported.expectedVersion,
    question,
    sourceRequestedFlags: Object.freeze([...exported.requestedFlags]),
    resolvedFlags: sortEnum(resolvedFlags, REQUEST_KIND_ORDER),
  };
}

