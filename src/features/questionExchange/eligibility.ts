import {
  aggregateKeywordQuestionStudy,
  type AggregatableQuestion,
  type AggregatableQuestionStats,
  type KeywordQuestionStudyAggregate,
} from '../questionStudy/statsContract';
import type {
  EligibilityFilter,
  EligibilityFilterInput,
  EligibilityReason,
  EligibilityTarget,
  FieldError,
  RequestKind,
} from './types';

export type EligibilityQuestion = AggregatableQuestion &
  Readonly<{ doubtFlag: boolean; explanationRequestFlag: boolean }>;

const FIELD_LABELS = {
  minimumAttempts: '最低出題回数',
  maximumAccuracy: '最大正答率',
  maximumQuestionCount: '最大設問数',
} as const;

function validateNonNegativeInteger(field: 'minimumAttempts' | 'maximumQuestionCount', value: unknown): FieldError | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { field, message: `${FIELD_LABELS[field]}を数値で入力してください。` };
  }
  if (!Number.isInteger(value) || value < 0) {
    return { field, message: `${FIELD_LABELS[field]}は0以上の整数で入力してください。` };
  }
  return null;
}

function validateAccuracy(value: unknown): FieldError | null {
  const field = 'maximumAccuracy';
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { field, message: `${FIELD_LABELS[field]}を数値で入力してください。` };
  }
  if (value < 0 || value > 1) {
    return { field, message: `${FIELD_LABELS[field]}は0以上1以下で入力してください。` };
  }
  return null;
}

/** 未入力・非数値・範囲外の閾値をfield順に返す。空配列なら抽出を開始できる。 */
export function validateEligibilityFilter(input: EligibilityFilterInput): readonly FieldError[] {
  return [
    validateNonNegativeInteger('minimumAttempts', input.minimumAttempts),
    validateAccuracy(input.maximumAccuracy),
    validateNonNegativeInteger('maximumQuestionCount', input.maximumQuestionCount),
  ].filter((error): error is FieldError => error !== null);
}

/** 統計branch: 誤答1以上 AND 出題回数下限以上 AND 正答率上限以下 AND 設問数上限以下。attempts 0は不成立。 */
export function meetsPerformanceCondition(aggregate: KeywordQuestionStudyAggregate, filter: EligibilityFilter): boolean {
  return (
    aggregate.attempts > 0 &&
    aggregate.accuracy !== null &&
    aggregate.wrong >= 1 &&
    aggregate.attempts >= filter.minimumAttempts &&
    aggregate.accuracy <= filter.maximumAccuracy &&
    aggregate.questionCount <= filter.maximumQuestionCount
  );
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 固定式 `疑義 OR 解説追加 OR (統計branch)` をkeyword単位で評価する。
 * 有効設問だけを対象とし、keywordごとに1 targetへ理由を重複なく統合してkeywordId順で返す。
 */
export function evaluateEligibility(
  filter: EligibilityFilter,
  questions: readonly EligibilityQuestion[],
  stats: readonly AggregatableQuestionStats[],
): EligibilityTarget[] {
  const errors = validateEligibilityFilter(filter);
  if (errors.length > 0) {
    throw new Error(`Invalid eligibility filter: ${errors.map((error) => error.field).join(', ')}`);
  }

  const flaggedByKeyword = new Map<string, Map<string, RequestKind[]>>();
  for (const question of questions) {
    if (!question.isActive) continue;
    const kinds: RequestKind[] = [];
    if (question.doubtFlag) kinds.push('doubt');
    if (question.explanationRequestFlag) kinds.push('explanation-request');
    if (kinds.length === 0) continue;
    const byQuestion = flaggedByKeyword.get(question.keywordId) ?? new Map<string, RequestKind[]>();
    if (!byQuestion.has(question.id)) byQuestion.set(question.id, kinds);
    flaggedByKeyword.set(question.keywordId, byQuestion);
  }

  const targets: EligibilityTarget[] = [];
  for (const aggregate of aggregateKeywordQuestionStudy(questions, stats)) {
    const flagged = [...(flaggedByKeyword.get(aggregate.keywordId) ?? new Map<string, RequestKind[]>()).entries()]
      .sort(([a], [b]) => compareIds(a, b))
      .map(([questionId, requestKinds]) => ({ questionId, requestKinds }));

    const reasons: EligibilityReason[] = [];
    if (flagged.some((q) => q.requestKinds.includes('doubt'))) reasons.push('doubt-flag');
    if (flagged.some((q) => q.requestKinds.includes('explanation-request'))) reasons.push('explanation-request-flag');
    if (meetsPerformanceCondition(aggregate, filter)) reasons.push('performance-and-count');
    if (reasons.length === 0) continue;

    const { keywordId, attempts, correct, wrong, accuracy, questionCount } = aggregate;
    targets.push({
      keywordId,
      metrics: { attempts, correct, wrong, accuracy, questionCount },
      reasons,
      flaggedQuestions: flagged,
    });
  }
  return targets;
}
