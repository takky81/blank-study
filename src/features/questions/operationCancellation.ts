export class QuestionBankOperationCancelled extends Error {
  constructor() {
    super('設問バンクの操作文脈が変更されました。');
    this.name = 'QuestionBankOperationCancelled';
  }
}

export function isQuestionBankOperationCancelled(value: unknown): value is QuestionBankOperationCancelled {
  return value instanceof QuestionBankOperationCancelled;
}
