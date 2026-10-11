import { describe, expect, it } from 'vitest';

import { validateImportOperations } from './preview';
import type { ImportOperation, QuestionExchangeImportV1 } from './types';

const K1 = '11111111-1111-4111-8111-111111111111';
const K2 = '22222222-2222-4222-8222-222222222222';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Q2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const content = { questionText: '問い', modelAnswer: '答え', choices: ['誤り'], explanation: null };
const create = (keywordId = K1): ImportOperation => ({ kind: 'create', keywordId, question: content });
const update = (questionId: string, overrides: Partial<Extract<ImportOperation, { kind: 'update' }>> = {}): ImportOperation => ({
  kind: 'update',
  keywordId: K1,
  questionId,
  expectedVersion: 1,
  question: content,
  sourceRequestedFlags: ['doubt'],
  resolvedFlags: ['doubt'],
  ...overrides,
});
const file = (operations: ImportOperation[]): QuestionExchangeImportV1 => ({
  schemaVersion: 1,
  exchangeId: '33333333-3333-4333-8333-333333333333',
  exportedAt: '2026-10-11T00:00:00Z',
  operations,
});
const snapshot = new Map([
  [Q1, K1],
  [Q2, K1],
]);

describe('validateImportOperations', () => {
  it('有効なcreateとupdateだけなら保存可能と判定する', () => {
    const result = validateImportOperations(file([create(), update(Q1)]), { questionKeywordIds: snapshot });
    expect(result).toEqual({ errors: [], canCommit: true });
  });

  it('operationが0件なら保存不可にする', () => {
    expect(validateImportOperations(file([]), { questionKeywordIds: snapshot }).canCommit).toBe(false);
  });

  it('通常編集と同じ内容規則違反を項目位置と理由付きで保存不可にする', () => {
    const bad = { kind: 'create', keywordId: K1, question: { ...content, questionText: ' ', choices: ['答え', ''] } } as const;
    const result = validateImportOperations(file([create(), bad]), { questionKeywordIds: snapshot });
    expect(result.canCommit).toBe(false);
    expect(result.errors).toEqual([
      { operationIndex: 1, path: '$.operations[1].question.questionText', message: '設問文を入力してください。' },
      { operationIndex: 1, path: '$.operations[1].question.choices[0]', message: '選択肢1は模範解答と重複しています。' },
      { operationIndex: 1, path: '$.operations[1].question.choices[1]', message: '選択肢2を入力してください。' },
    ]);
  });

  it('同じquestion IDの複数updateを重複箇所付きで保存不可にする', () => {
    const result = validateImportOperations(file([update(Q1), update(Q2), update(Q1)]), { questionKeywordIds: snapshot });
    expect(result.canCommit).toBe(false);
    expect(result.errors).toEqual([
      { operationIndex: 2, path: '$.operations[2].questionId', message: `設問ID ${Q1} が重複しています（operations[0]と重複）。` },
    ]);
  });

  it('keywordと設問の不一致・未知の設問IDを保存不可にする', () => {
    const result = validateImportOperations(
      file([update(Q1, { keywordId: K2 }), update('cccccccc-cccc-4ccc-8ccc-cccccccccccc')]),
      { questionKeywordIds: snapshot },
    );
    expect(result.canCommit).toBe(false);
    expect(result.errors.map((e) => e.path)).toEqual(['$.operations[0].keywordId', '$.operations[1].questionId']);
  });

  it('sourceRequestedFlagsを超えるresolvedFlagsを保存不可にする', () => {
    const result = validateImportOperations(
      file([create(), update(Q1, { sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt', 'explanation-request'] })]),
      { questionKeywordIds: snapshot },
    );
    expect(result).toEqual({
      canCommit: false,
      errors: [
        { operationIndex: 1, path: '$.operations[1].resolvedFlags[1]', message: '対応対象として示されていないフラグ explanation-request は解除できません。' },
      ],
    });
  });

  it('有効なoperationが混在しても1件のerrorで全体を保存不可にする', () => {
    const result = validateImportOperations(
      file([create(), update(Q2), create(K2), update(Q1, { resolvedFlags: ['explanation-request'] })]),
      { questionKeywordIds: snapshot },
    );
    expect(result.errors).toHaveLength(1);
    expect(result.canCommit).toBe(false);
  });
});
