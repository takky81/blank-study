import { describe, expect, it } from 'vitest';

import type { QuestionContentDraft } from './types';
import {
  normalizeQuestionDraft,
  validateQuestionContent,
  validateQuestionDraft,
} from './validation';

const validInput = (overrides: Partial<QuestionContentDraft> = {}): QuestionContentDraft => ({
  questionText: '  CPUとは何ですか  ',
  modelAnswer: '  中央処理装置  ',
  choices: [' 演算装置 ', ' 制御装置 '],
  explanation: '  コンピューターの中核です。  ',
  ...overrides,
});

describe('normalizeQuestionDraft', () => {
  it('必須値と選択肢をtrimし、選択肢の順序を維持する', () => {
    expect(normalizeQuestionDraft(validInput())).toEqual({
      questionText: 'CPUとは何ですか',
      modelAnswer: '中央処理装置',
      choices: ['演算装置', '制御装置'],
      explanation: 'コンピューターの中核です。',
    });
  });

  it.each([null, '', ' 　 '])('未入力または空白だけの解説 %j をnullにする', (explanation) => {
    expect(normalizeQuestionDraft(validInput({ explanation })).explanation).toBeNull();
  });
});

describe('validateQuestionDraft', () => {
  it('trim後に空の設問文と模範解答をfield別に報告する', () => {
    expect(validateQuestionDraft(validInput({ questionText: '  ', modelAnswer: '　' }))).toEqual([
      { field: 'questionText', message: '設問文を入力してください。' },
      { field: 'modelAnswer', message: '模範解答を入力してください。' },
    ]);
  });

  it('空の選択肢の位置を報告する', () => {
    expect(validateQuestionDraft(validInput({ choices: ['有効', '　'] }))).toContainEqual({
      field: 'choices',
      index: 1,
      message: '選択肢2を入力してください。',
    });
  });

  it('共有正答正規化後に重複する選択肢の位置を報告する', () => {
    expect(validateQuestionDraft(validInput({ choices: ['ＣＰＵ', ' cpu '] }))).toContainEqual({
      field: 'choices',
      index: 1,
      message: '選択肢2が重複しています。',
    });
  });

  it('共有正答正規化後に模範解答と重複する選択肢を報告する', () => {
    expect(
      validateQuestionDraft(validInput({ modelAnswer: 'CPU', choices: [' Ｃｐｕ '] })),
    ).toContainEqual({
      field: 'choices',
      index: 0,
      message: '選択肢1は模範解答と重複しています。',
    });
  });

  it('共有正答正規化どおり全角円記号とASCIIバックスラッシュを別の値として扱う', () => {
    expect(validateQuestionDraft(validInput({ modelAnswer: '\\', choices: ['￥'] }))).toEqual([]);
  });
});

describe('validateQuestionContent', () => {
  it('有効な入力では正規化済みdraftを返す', () => {
    expect(validateQuestionContent(validInput())).toEqual({
      valid: true,
      draft: {
        questionText: 'CPUとは何ですか',
        modelAnswer: '中央処理装置',
        choices: ['演算装置', '制御装置'],
        explanation: 'コンピューターの中核です。',
      },
    });
  });

  it('無効な入力ではdraftを返さずfield errorを返す', () => {
    const result = validateQuestionContent(validInput({ choices: ['', 'CPU'], modelAnswer: 'cpu' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(2);
    }
  });
});
