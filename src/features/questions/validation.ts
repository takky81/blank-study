import { normalizeAnswer } from '@/lib/answer';

import type {
  QuestionContentDraft,
  QuestionContentValidationResult,
  QuestionFieldError,
} from './types';

export function normalizeQuestionDraft(input: QuestionContentDraft): QuestionContentDraft {
  return {
    questionText: input.questionText.trim(),
    modelAnswer: input.modelAnswer.trim(),
    choices: input.choices.map((choice) => choice.trim()),
    explanation: input.explanation?.trim() || null,
  };
}

export function validateQuestionDraft(input: QuestionContentDraft): readonly QuestionFieldError[] {
  const draft = normalizeQuestionDraft(input);
  const errors: QuestionFieldError[] = [];

  if (draft.questionText === '') {
    errors.push({ field: 'questionText', message: '設問文を入力してください。' });
  }
  if (draft.modelAnswer === '') {
    errors.push({ field: 'modelAnswer', message: '模範解答を入力してください。' });
  }

  const normalizedChoices = new Set<string>();
  const normalizedModelAnswer = normalizeAnswer(draft.modelAnswer);
  draft.choices.forEach((choice, index) => {
    const normalizedChoice = normalizeAnswer(choice);
    if (normalizedChoice === '') {
      errors.push({
        field: 'choices',
        index,
        message: `選択肢${index + 1}を入力してください。`,
      });
      return;
    }
    if (normalizedChoices.has(normalizedChoice)) {
      errors.push({
        field: 'choices',
        index,
        message: `選択肢${index + 1}が重複しています。`,
      });
    } else {
      normalizedChoices.add(normalizedChoice);
    }
    if (normalizedChoice === normalizedModelAnswer) {
      errors.push({
        field: 'choices',
        index,
        message: `選択肢${index + 1}は模範解答と重複しています。`,
      });
    }
  });

  return errors;
}

export function validateQuestionContent(
  input: QuestionContentDraft,
): QuestionContentValidationResult {
  const errors = validateQuestionDraft(input);
  return errors.length === 0
    ? { valid: true, draft: normalizeQuestionDraft(input) }
    : { valid: false, errors };
}
