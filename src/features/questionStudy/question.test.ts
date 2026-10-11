import { describe, expect, it } from 'vitest';

import type { QuestionStudyStats } from './candidates';
import {
  buildQuestionChoiceOptions,
  canSubmitWrittenAnswer,
  judgeQuestionAnswer,
  judgeQuestionChoice,
  resolveQuestionMode,
} from './question';
import { SETTLED_COUNT, SETTLED_RATE } from '@/features/study/question';

function stats(askedCount: number, correctCount: number): QuestionStudyStats {
  return {
    questionId: 'q1', askedCount, correctCount, consecutiveCorrect: 0,
    intervalDays: 0, easeFactor: 2.5, dueAt: null, updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('resolveQuestionMode', () => {
  const choices = ['誤答A', '誤答B'];

  it('選択式指定は選択式になる', () => {
    expect(resolveQuestionMode('choice', stats(10, 10), choices)).toBe('choice');
  });
  it('記述式指定は記述式になる', () => {
    expect(resolveQuestionMode('written', null, choices)).toBe('written');
  });
  it('自動で専用統計がなければ選択式になる', () => {
    expect(resolveQuestionMode('auto', null, choices)).toBe('choice');
  });
  it('自動で定着していれば記述式、未定着なら選択式になる', () => {
    expect(resolveQuestionMode('auto', stats(10, 9), choices)).toBe('written');
    expect(resolveQuestionMode('auto', stats(10, 5), choices)).toBe('choice');
    expect(resolveQuestionMode('auto', stats(2, 2), choices)).toBe('choice');
  });
  it('選択肢が不足すれば選択式指定でも記述式へ切り替える', () => {
    expect(resolveQuestionMode('choice', null, [])).toBe('written');
    expect(resolveQuestionMode('auto', null, ['', '　'])).toBe('written');
  });
});

describe('buildQuestionChoiceOptions', () => {
  it('模範解答を1回だけ含め、重複しない登録選択肢を登録順に並べ、わからないを区別する', () => {
    const result = buildQuestionChoiceOptions('東京', ['大阪', '東京', '京都', 'ＡＢＣ', 'abc', ' 大阪 ', '']);
    expect(result.options.map((o) => o.value)).toEqual(['東京', '大阪', '京都', 'ＡＢＣ']);
    expect(result.options.filter((o) => o.isModelAnswer).map((o) => o.value)).toEqual(['東京']);
    expect(result.unknown).toEqual({ label: 'わからない', unknown: true });
    expect(result.options.some((o) => o.value === 'わからない')).toBe(false);
  });
  it('模範解答以外の選択肢がなければ記述式へ切り替わる', () => {
    const result = buildQuestionChoiceOptions('東京', ['東京', ' 東京 ', '']);
    expect(resolveQuestionMode('choice', null, result.distractors)).toBe('written');
  });
});

describe('judgeQuestionAnswer', () => {
  it('共通正規化後の完全一致だけを正解とする', () => {
    expect(judgeQuestionAnswer(' ＡＢＣ ', 'abc')).toBe(true);
    expect(judgeQuestionAnswer('ab', 'abc')).toBe(false);
    expect(judgeQuestionAnswer('東京都', '東京')).toBe(false);
  });
  it('空の記述回答は確定できず、不正解扱い', () => {
    expect(canSubmitWrittenAnswer('　 ')).toBe(false);
    expect(canSubmitWrittenAnswer('a')).toBe(true);
    expect(judgeQuestionAnswer('', '')).toBe(false);
  });
  it('わからないは不正解になる', () => {
    expect(judgeQuestionChoice({ value: 'わからない', unknown: true }, 'わからない')).toBe(false);
    expect(judgeQuestionChoice({ value: '東京', unknown: false }, '東京')).toBe(true);
  });
});

describe('上流しきい値の境界', () => {
  const choices = ['誤答A'];
  it('出題数がSETTLED_COUNT未満なら全問正解でも選択式', () => {
    expect(resolveQuestionMode('auto', stats(SETTLED_COUNT - 1, SETTLED_COUNT - 1), choices)).toBe('choice');
  });
  it('正答率がSETTLED_RATEちょうど以上で記述式、未満で選択式', () => {
    const total = 100;
    const atRate = Math.ceil(total * SETTLED_RATE);
    expect(resolveQuestionMode('auto', stats(total, atRate), choices)).toBe('written');
    expect(resolveQuestionMode('auto', stats(total, atRate - 1), choices)).toBe('choice');
    expect(resolveQuestionMode('auto', stats(SETTLED_COUNT, SETTLED_COUNT), choices)).toBe('written');
  });
  it('選択肢が1件あれば選択式指定は選択式のまま', () => {
    expect(resolveQuestionMode('choice', null, choices)).toBe('choice');
  });
  it('空白だけの記述回答は不正解', () => {
    expect(judgeQuestionAnswer('　 ', '東京')).toBe(false);
    expect(canSubmitWrittenAnswer('')).toBe(false);
  });
});
