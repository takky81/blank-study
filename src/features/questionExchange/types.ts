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
