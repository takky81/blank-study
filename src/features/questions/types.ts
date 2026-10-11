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

export type StructuredQuestionConsumerView = Readonly<{
  id: QuestionId;
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
  version: number;
  updatedAt: string;
}>;

export type ConsumerFlagMutationResult =
  | Readonly<{ kind: 'saved'; question: StructuredQuestionConsumerView }>
  | Readonly<{ kind: 'version-conflict'; current: StructuredQuestionConsumerView }>;

export type StructuredQuestionReadContract = {
  listQuestionsByMaterial(materialId: string): Promise<readonly StructuredQuestionConsumerView[]>;
};

export type FlagMutationContract = {
  setQuestionFlags(
    id: QuestionId,
    expectedVersion: number,
    flags: QuestionFlagPatch,
  ): Promise<ConsumerFlagMutationResult>;
};
