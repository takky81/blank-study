import { describe, it, expect } from 'vitest';
import { pickNext, RECENT_LIMIT, type Candidate } from './order';

const now = new Date('2026-08-29T00:00:00.000Z');

function at(days: number): Date {
  return new Date(now.getTime() + days * 86400000);
}

/** 出現順は position で表す。章の順序・章内の出現順を1つに畳んだもの。 */
function candidate(id: string, position: number, dueAt: Date | null = null): Candidate {
  return { keywordId: id, position, dueAt };
}

describe('pickNext（決定表「出題順」）', () => {
  it('列1 自動順は未出題を最優先する', () => {
    const picked = pickNext(
      [candidate('a', 0, at(-5)), candidate('b', 1, null)],
      { order: 'auto', recent: [], now },
    );
    expect(picked?.keywordId).toBe('b');
  });

  it('列14 未出題どうしは出現順で出す', () => {
    const picked = pickNext([candidate('b', 1), candidate('a', 0)], {
      order: 'auto',
      recent: [],
      now,
    });
    expect(picked?.keywordId).toBe('a');
  });

  it('列2 未出題が無ければ期限が来たものを昇順で出す', () => {
    const picked = pickNext(
      [candidate('a', 0, at(-1)), candidate('b', 1, at(-3))],
      { order: 'auto', recent: [], now },
    );
    expect(picked?.keywordId).toBe('b');
  });

  it('列3 期限前でも近い順に前倒しで出す', () => {
    const picked = pickNext(
      [candidate('a', 0, at(9)), candidate('b', 1, at(2))],
      { order: 'auto', recent: [], now },
    );
    expect(picked?.keywordId).toBe('b');
  });

  it('列15 同じ due_at どうしは出現順で出す', () => {
    const picked = pickNext(
      [candidate('b', 1, at(-1)), candidate('a', 0, at(-1))],
      { order: 'auto', recent: [], now },
    );
    expect(picked?.keywordId).toBe('a');
  });

  it('列4 候補が多いときは直近10件に出たものを飛ばす', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`k${i}`, i, at(-1)));
    const picked = pickNext(candidates, { order: 'auto', recent: ['k0', 'k1'], now });
    expect(picked?.keywordId).toBe('k2');
  });

  it('列9 候補がちょうど10件なら制限をそのまま当てる', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`k${i}`, i, at(-1)));
    const picked = pickNext(candidates, { order: 'auto', recent: ['k0'], now });
    expect(picked?.keywordId).toBe('k1');
  });

  it('列5・列10 候補が9件なら制限を緩めて出す', () => {
    const candidates = Array.from({ length: 9 }, (_, i) => candidate(`k${i}`, i, at(-1)));
    const picked = pickNext(candidates, {
      order: 'auto',
      recent: candidates.map((c) => c.keywordId),
      now,
    });
    expect(picked?.keywordId).toBe('k0');
  });

  it('直近10件を全部避けると出せないときは緩めて出す', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`k${i}`, i, at(-1)));
    const picked = pickNext(candidates, {
      order: 'auto',
      recent: candidates.map((c) => c.keywordId),
      now,
    });
    expect(picked?.keywordId).toBe('k0');
  });

  it('列6 出現順は本文の並びどおりに出し、未出題も期限も見ない', () => {
    const picked = pickNext(
      [candidate('a', 0, at(-9)), candidate('b', 1, null)],
      { order: 'sequential', recent: [], now },
    );
    expect(picked?.keywordId).toBe('a');
  });

  it('列6 出現順でも直近に出たものは飛ばす', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`k${i}`, i));
    const picked = pickNext(candidates, { order: 'sequential', recent: ['k0'], now });
    expect(picked?.keywordId).toBe('k1');
  });

  it('列12 候補が無ければ何も返さない', () => {
    expect(pickNext([], { order: 'auto', recent: [], now })).toBeNull();
  });

  it('連続回避の範囲は直近10件', () => {
    expect(RECENT_LIMIT).toBe(10);
  });
});
