import { describe, expect, it } from 'vitest';
import { aggregateKeywordQuestionStudy } from './statsContract';

describe('aggregateKeywordQuestionStudy', () => {
  it('有効設問だけをkeyword単位で合計し、差分と正答率を導出する', () => {
    const result = aggregateKeywordQuestionStudy(
      [
        { id: 'q1', keywordId: 'k1', isActive: true },
        { id: 'q2', keywordId: 'k1', isActive: true },
        { id: 'q3', keywordId: 'k1', isActive: false },
      ],
      [
        { questionId: 'q1', askedCount: 3, correctCount: 2 },
        { questionId: 'q2', askedCount: 1, correctCount: 0 },
        { questionId: 'q3', askedCount: 9, correctCount: 9 },
        { questionId: 'gone', askedCount: 5, correctCount: 5 },
      ],
    );
    expect(result).toEqual([{ keywordId: 'k1', attempts: 4, correct: 2, wrong: 2, accuracy: 0.5, questionCount: 2 }]);
  });

  it('statsなしは0件、attempts 0はaccuracy nullの未出題として返し、有効設問のないkeywordは返さない', () => {
    const result = aggregateKeywordQuestionStudy(
      [
        { id: 'q1', keywordId: 'k2', isActive: true },
        { id: 'q2', keywordId: 'k1', isActive: true },
        { id: 'q3', keywordId: 'k3', isActive: false },
      ],
      [{ questionId: 'q2', askedCount: 0, correctCount: 0 }],
    );
    expect(result).toEqual([
      { keywordId: 'k1', attempts: 0, correct: 0, wrong: 0, accuracy: null, questionCount: 1 },
      { keywordId: 'k2', attempts: 0, correct: 0, wrong: 0, accuracy: null, questionCount: 1 },
    ]);
  });

  it('重複した設問やstatsを二重計上しない', () => {
    const result = aggregateKeywordQuestionStudy(
      [{ id: 'q1', keywordId: 'k1', isActive: true }, { id: 'q1', keywordId: 'k1', isActive: true }],
      [{ questionId: 'q1', askedCount: 2, correctCount: 1 }, { questionId: 'q1', askedCount: 2, correctCount: 1 }],
    );
    expect(result).toEqual([{ keywordId: 'k1', attempts: 2, correct: 1, wrong: 1, accuracy: 0.5, questionCount: 1 }]);
  });
});
