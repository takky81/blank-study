import type { QuestionContentDraft } from '../questions/types';

/** 抽出閾値。各値は検証済みであることを前提に評価へ渡す。 */
export type EligibilityFilter = {
  minimumAttempts: number;
  maximumAccuracy: number;
  maximumQuestionCount: number;
};

export type EligibilityFilterField = keyof EligibilityFilter;

/** 未入力・非数値を検出するため、画面入力はunknown値として受け取る。 */
export type EligibilityFilterInput = { readonly [K in EligibilityFilterField]: unknown };

export type FieldError = { field: EligibilityFilterField; message: string };

export type EligibilityReason = 'doubt-flag' | 'explanation-request-flag' | 'performance-and-count';

export type RequestKind = 'doubt' | 'explanation-request';

export type EligibilityMetrics = {
  attempts: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
  questionCount: number;
};

export type EligibilityTarget = {
  keywordId: string;
  metrics: EligibilityMetrics;
  reasons: readonly EligibilityReason[];
  flaggedQuestions: readonly {
    questionId: string;
    requestKinds: readonly RequestKind[];
  }[];
};

// ---- Exchange schema v1 ----

export type { QuestionContentDraft } from '../questions/types';

export const EXCHANGE_SCHEMA_VERSION = 1 as const;

export type ExchangeHeader = {
  schemaVersion: typeof EXCHANGE_SCHEMA_VERSION;
  exchangeId: string;
  exportedAt: string;
};

export type ExportQuestion = {
  questionId: string;
  expectedVersion: number;
  sortOrder: number;
  questionText: string;
  modelAnswer: string;
  choices: readonly string[];
  explanation: string | null;
  requestedFlags: readonly RequestKind[];
};

export type CreateOperation = { kind: 'create'; keywordId: string; question: QuestionContentDraft };

export type UpdateOperation = {
  kind: 'update';
  keywordId: string;
  questionId: string;
  expectedVersion: number;
  question: QuestionContentDraft;
  sourceRequestedFlags: readonly RequestKind[];
  resolvedFlags: readonly RequestKind[];
};

export type ImportOperation = CreateOperation | UpdateOperation;

export type QuestionExchangeImportV1 = ExchangeHeader & {
  operations: readonly ImportOperation[];
};

export type QuestionExchangeFilterV1 = EligibilityFilter;

export type HierarchyNodeV1 = { id: string; title: string; sortOrder: number };

export type ChapterContextV1 = {
  subject: HierarchyNodeV1;
  material: HierarchyNodeV1;
  chapter: HierarchyNodeV1 & { bodyMarkdown: string };
};

export type FlaggedQuestionV1 = { questionId: string; requestKinds: readonly RequestKind[] };

export type QuestionExchangeTargetV1 = {
  keyword: { id: string; displayText: string; modelAnswer: string };
  metrics: EligibilityMetrics;
  reasons: readonly EligibilityReason[];
  chapterContexts: readonly ChapterContextV1[];
  questions: readonly ExportQuestion[];
  flaggedQuestions: readonly FlaggedQuestionV1[];
};

export type QuestionExchangeExportV1 = ExchangeHeader & {
  filters: QuestionExchangeFilterV1;
  targets: readonly QuestionExchangeTargetV1[];
};

/** JSON path（例: `$.targets[0].keyword.id`）付きの構造検証エラー。 */
export type ExchangeSchemaError = { path: string; message: string };

export type ExchangeParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly ExchangeSchemaError[] };

/** import operation検証で検出した保存不可error。operationIndexはfile全体のerrorではnull。 */
export type ImportValidationError = { operationIndex: number | null; path: string; message: string };

export type ImportValidationResult = {
  errors: readonly ImportValidationError[];
  /** errorが0件かつoperationが1件以上の場合だけtrue。部分保存は行わない。 */
  canCommit: boolean;
};
