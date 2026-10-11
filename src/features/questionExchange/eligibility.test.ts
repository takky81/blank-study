import { describe, expect, it } from 'vitest';
import fixture from './fixtures/eligibility-cases.json';
import { evaluateEligibility, validateEligibilityFilter } from './eligibility';
import type { EligibilityTarget } from './types';

describe('evaluateEligibility（共有fixture）', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(evaluateEligibility(c.filter, c.questions, c.stats)).toEqual(c.expected as EligibilityTarget[]);
  });
});

describe('validateEligibilityFilter', () => {
  const valid = { minimumAttempts: 0, maximumAccuracy: 0, maximumQuestionCount: 0 };

  it('下限0・正答率0と1の境界値はエラーなしとする', () => {
    expect(validateEligibilityFilter(valid)).toEqual([]);
    expect(validateEligibilityFilter({ minimumAttempts: 1000, maximumAccuracy: 1, maximumQuestionCount: 1000 })).toEqual([]);
  });

  it('未入力、数値でない値、範囲外、非整数を該当fieldのエラーとして示す', () => {
    expect(
      validateEligibilityFilter({ minimumAttempts: undefined, maximumAccuracy: '0.5', maximumQuestionCount: Number.NaN }),
    ).toEqual([
      { field: 'minimumAttempts', message: expect.any(String) },
      { field: 'maximumAccuracy', message: expect.any(String) },
      { field: 'maximumQuestionCount', message: expect.any(String) },
    ]);
    expect(
      validateEligibilityFilter({ minimumAttempts: -1, maximumAccuracy: 1.01, maximumQuestionCount: 1.5 }).map((e) => e.field),
    ).toEqual(['minimumAttempts', 'maximumAccuracy', 'maximumQuestionCount']);
    expect(validateEligibilityFilter({ ...valid, maximumAccuracy: -0.01 }).map((e) => e.field)).toEqual(['maximumAccuracy']);
    expect(validateEligibilityFilter({ ...valid, minimumAttempts: Number.POSITIVE_INFINITY }).map((e) => e.field)).toEqual([
      'minimumAttempts',
    ]);
  });

  it('不正なfilterでは抽出を開始しない', () => {
    expect(() => evaluateEligibility({ ...valid, maximumAccuracy: 2 }, [], [])).toThrow();
  });
});
