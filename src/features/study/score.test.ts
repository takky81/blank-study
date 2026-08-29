import { describe, it, expect } from 'vitest';
import { keywordScore } from './score';

// 決定表「正誤判定」 spec/tables/16-judge.jsonl
describe('その問題の成績', () => {
  it('列17 keywordScore: 今回の解答を含めて数える', () => {
    const stats = { totalCount: 3, correctCount: 2 };
    expect(keywordScore(stats, true)).toEqual({ correctCount: 3, totalCount: 4, rate: 0.75 });
    expect(keywordScore(stats, false)).toEqual({ correctCount: 2, totalCount: 4, rate: 0.5 });
  });

  it('列18 keywordScore: 初めての出題は今回の解答だけで出す', () => {
    expect(keywordScore(null, true)).toEqual({ correctCount: 1, totalCount: 1, rate: 1 });
    expect(keywordScore(null, false)).toEqual({ correctCount: 0, totalCount: 1, rate: 0 });
    expect(keywordScore({ totalCount: 0, correctCount: 0 }, true)).toEqual({
      correctCount: 1,
      totalCount: 1,
      rate: 1,
    });
  });

  it('列17 正答率は正答数を出題数で割った値', () => {
    expect(keywordScore({ totalCount: 2, correctCount: 0 }, true).rate).toBeCloseTo(1 / 3, 10);
    expect(keywordScore({ totalCount: 8, correctCount: 8 }, false).rate).toBeCloseTo(8 / 9, 10);
  });
});
