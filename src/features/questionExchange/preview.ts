import { validateQuestionDraft } from '../questions/validation';
import type { StructuredQuestion } from '../questions/types';

import type {
  ImportOperation,
  ImportValidationError,
  ImportValidationResult,
  QuestionContentDraft,
  QuestionExchangeImportV1,
} from './types';

export type ImportValidationContext = {
  /** owner所有のactive設問IDから所属keyword IDへの現在snapshot。 */
  questionKeywordIds: ReadonlyMap<string, string>;
};

/**
 * parse済みimport fileの各operationを、question bankのQuestionContentPolicy（通常編集と同じ規則）、
 * question ID重複、keyword/question整合、resolvedFlags⊆sourceRequestedFlagsで検証する。
 * 1件でもerrorがあればfile全体を保存不可とする。
 */
export function validateImportOperations(
  file: QuestionExchangeImportV1,
  context: ImportValidationContext,
): ImportValidationResult {
  const errors: ImportValidationError[] = [];
  const seenQuestionIds = new Map<string, number>();

  file.operations.forEach((operation, operationIndex) => {
    const base = `$.operations[${operationIndex}]`;
    const push = (path: string, message: string) => errors.push({ operationIndex, path: `${base}${path}`, message });

    for (const error of validateQuestionDraft(operation.question)) {
      push(error.field === 'choices' ? `.question.choices[${error.index}]` : `.question.${error.field}`, error.message);
    }

    if (operation.kind !== 'update') return;

    const firstIndex = seenQuestionIds.get(operation.questionId);
    if (firstIndex !== undefined) {
      push('.questionId', `設問ID ${operation.questionId} が重複しています（operations[${firstIndex}]と重複）。`);
    } else {
      seenQuestionIds.set(operation.questionId, operationIndex);
      const currentKeywordId = context.questionKeywordIds.get(operation.questionId);
      if (currentKeywordId === undefined) {
        push('.questionId', `設問ID ${operation.questionId} は存在しません。`);
      } else if (currentKeywordId !== operation.keywordId) {
        push('.keywordId', `設問ID ${operation.questionId} はkeyword ${operation.keywordId} に属していません。`);
      }
    }

    operation.resolvedFlags.forEach((flag, flagIndex) => {
      if (!operation.sourceRequestedFlags.includes(flag)) {
        push(`.resolvedFlags[${flagIndex}]`, `対応対象として示されていないフラグ ${flag} は解除できません。`);
      }
    });
  });

  return { errors, canCommit: errors.length === 0 && file.operations.length > 0 };
}

// ---- Import preview planner ----

/** RLS下のSELECTだけで得たowner可視snapshot。他ownerの行は現れないため未知と区別できない。 */
export type ImportPreviewSnapshot = {
  questions: ReadonlyMap<string, StructuredQuestion>;
  keywordIds: ReadonlySet<string>;
};

export type PreviewItem =
  | { kind: 'create'; operationIndex: number; keywordId: string; draft: QuestionContentDraft }
  | { kind: 'update'; operationIndex: number; keywordId: string; before: StructuredQuestion; after: QuestionContentDraft }
  | { kind: 'conflict'; operationIndex: number; current: StructuredQuestion; incoming: ImportOperation }
  | { kind: 'error'; operationIndex: number | null; path: string; message: string };

export type ImportPreview = { items: readonly PreviewItem[]; canCommit: boolean };

const FLAG_FIELD = { doubt: 'doubtFlag', 'explanation-request': 'explanationRequestFlag' } as const;

/**
 * 検証済みimportとcurrent snapshotを照合し、create/update/conflict/errorへ分類する純粋関数。
 * 未知・他owner・無効化済み参照は同一のerror表現になる。error/conflictが1件でもあれば保存不可。
 */
export function planImportPreview(file: QuestionExchangeImportV1, snapshot: ImportPreviewSnapshot): ImportPreview {
  const questionKeywordIds = new Map<string, string>();
  for (const q of snapshot.questions.values()) if (q.isActive) questionKeywordIds.set(q.id, q.keywordId);

  const errors: ImportValidationError[] = [...validateImportOperations(file, { questionKeywordIds }).errors];
  file.operations.forEach((operation, operationIndex) => {
    const base = `$.operations[${operationIndex}]`;
    if (!snapshot.keywordIds.has(operation.keywordId)) {
      errors.push({ operationIndex, path: `${base}.keywordId`, message: `keyword ID ${operation.keywordId} は存在しません。` });
    }
    if (operation.kind !== 'update') return;
    const currentQuestion = snapshot.questions.get(operation.questionId);
    if (!currentQuestion?.isActive) return;
    operation.resolvedFlags.forEach((flag, flagIndex) => {
      if (operation.sourceRequestedFlags.includes(flag) && !currentQuestion[FLAG_FIELD[flag]]) {
        errors.push({
          operationIndex,
          path: `${base}.resolvedFlags[${flagIndex}]`,
          message: `設問ID ${operation.questionId} のフラグ ${flag} は現在立っていないため解除できません。`,
        });
      }
    });
  });

  const failed = new Set(errors.map((e) => e.operationIndex));
  const items: PreviewItem[] = [];
  file.operations.forEach((operation, operationIndex) => {
    if (failed.has(operationIndex)) return;
    if (operation.kind === 'create') {
      items.push({ kind: 'create', operationIndex, keywordId: operation.keywordId, draft: operation.question });
      return;
    }
    const before = snapshot.questions.get(operation.questionId)!;
    items.push(before.version === operation.expectedVersion
      ? { kind: 'update', operationIndex, keywordId: operation.keywordId, before, after: operation.question }
      : { kind: 'conflict', operationIndex, current: before, incoming: operation });
  });
  const ordered = [...errors].sort((a, b) => (a.operationIndex ?? -1) - (b.operationIndex ?? -1));
  for (const e of ordered) items.push({ kind: 'error', ...e });
  items.sort((a, b) => (a.operationIndex ?? -1) - (b.operationIndex ?? -1));

  return {
    items,
    canCommit: file.operations.length > 0 && items.every((i) => i.kind === 'create' || i.kind === 'update'),
  };
}
