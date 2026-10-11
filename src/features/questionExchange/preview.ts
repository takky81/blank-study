import { validateQuestionDraft } from '../questions/validation';

import type { ImportValidationError, ImportValidationResult, QuestionExchangeImportV1 } from './types';

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
