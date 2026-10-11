export type QuestionId = string;

export type QuestionVersionToken = {
  id: QuestionId;
  version: number;
  updatedAt: string;
};

export type StructuredQuestion = QuestionVersionToken & {
  ownerId: string;
  materialId: string;
  keywordId: string;
  questionText: string;
  modelAnswer: string;
  choices: readonly string[];
  explanation: string | null;
  sortOrder: number;
  isActive: boolean;
  doubtFlag: boolean;
  explanationRequestFlag: boolean;
};

export type QuestionContentDraft = Pick<
  StructuredQuestion,
  'questionText' | 'modelAnswer' | 'choices' | 'explanation'
>;

export type QuestionDraft = { keywordId: string } & QuestionContentDraft;

export type QuestionField = 'questionText' | 'modelAnswer' | 'choices';

export type QuestionFieldError =
  | {
      field: Exclude<QuestionField, 'choices'>;
      message: string;
    }
  | {
      field: 'choices';
      index: number;
      message: string;
    };

export type QuestionContentValidationResult =
  | { valid: true; draft: QuestionContentDraft }
  | { valid: false; errors: readonly QuestionFieldError[] };

export type VersionConflict = { kind: 'version-conflict'; current: StructuredQuestion };

export type MutationResult =
  | { kind: 'saved'; question: StructuredQuestion }
  | VersionConflict;

export type QuestionFlagPatch = {
  doubtFlag?: boolean;
  explanationRequestFlag?: boolean;
};

export type DeleteQuestionResult = 'deleted' | VersionConflict;

export type ReorderQuestionResult = readonly StructuredQuestion[] | VersionConflict;
