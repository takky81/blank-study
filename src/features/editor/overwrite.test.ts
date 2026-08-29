import { describe, it, expect } from 'vitest';
import { planSave } from './overwrite';
import type { KeywordDefinition } from '@/lib/body';

const existing = new Map([
  ['a3f9k2', { answers: ['光合成', '炭酸同化'], tags: ['生物'], wrongChoices: [] }],
]);

function keyword(docId: string, answers: string[]): KeywordDefinition {
  return { docId, answers, tags: [], wrongChoices: [] };
}

describe('planSave（決定表「保存時の上書き確認」）', () => {
  it('列1 ダイアログで変えたものは確認しない', () => {
    const plan = planSave([keyword('a3f9k2', ['まったく別の語'])], existing, new Set(['a3f9k2']));
    expect(plan.conflicts).toEqual([]);
    expect(plan.apply).toHaveLength(1);
  });

  it('列2 正答が1つ以上一致すれば確認しない', () => {
    const plan = planSave([keyword('a3f9k2', ['光合成', '同化作用'])], existing, new Set());
    expect(plan.conflicts).toEqual([]);
  });

  it('列3 1つも一致しなければ確認する', () => {
    const plan = planSave([keyword('a3f9k2', ['呼吸'])], existing, new Set());
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ docId: 'a3f9k2', reason: 'answers' });
  });

  it('列6 同じ保存の中で同じ id の内容が食い違えば確認する', () => {
    const plan = planSave(
      [keyword('w4d8x1', ['光合成']), keyword('w4d8x1', ['呼吸'])],
      existing,
      new Set(),
    );
    expect(plan.conflicts[0]).toMatchObject({ docId: 'w4d8x1', reason: 'duplicate' });
  });

  it('列8 確認の対象は一致しないものだけにする', () => {
    const plan = planSave(
      [keyword('a3f9k2', ['呼吸']), keyword('zzzzzz', ['新しい語'])],
      existing,
      new Set(),
    );
    expect(plan.conflicts.map((c) => c.docId)).toEqual(['a3f9k2']);
    expect(plan.apply.map((p) => p.docId)).toEqual(['zzzzzz']);
  });

  it('列9 id を書き換えたものは別のキーワードとして新規になる', () => {
    const plan = planSave([keyword('zzzzzz', ['光合成'])], existing, new Set());
    expect(plan.conflicts).toEqual([]);
    expect(plan.apply[0]).toMatchObject({ kind: 'new', docId: 'zzzzzz' });
  });
});
