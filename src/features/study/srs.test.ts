import { describe, it, expect } from 'vitest';
import { updateSrs, INITIAL_EASE_FACTOR, MIN_EASE_FACTOR, type SrsState } from './srs';

const now = new Date('2026-08-29T00:00:00.000Z');

/** 何日後になったかを返す。 */
function daysUntil(dueAt: Date): number {
  return Math.round((dueAt.getTime() - now.getTime()) / 86400000);
}

function state(over: Partial<SrsState> = {}): SrsState {
  return { repetition: 0, interval: 0, easeFactor: INITIAL_EASE_FACTOR, ...over };
}

describe('updateSrs（決定表「SRS の更新」）', () => {
  it('列1 初回の正解は1日後', () => {
    const next = updateSrs(state(), { correct: true, now });
    expect(next.repetition).toBe(1);
    expect(next.interval).toBe(1);
    expect(daysUntil(next.dueAt)).toBe(1);
  });

  it('列2 2回目の正解は6日後', () => {
    const next = updateSrs(state({ repetition: 1, interval: 1 }), { correct: true, now });
    expect(next.repetition).toBe(2);
    expect(next.interval).toBe(6);
  });

  it('列3・列11 3回目以降は直前の interval に EF を掛ける', () => {
    const next = updateSrs(state({ repetition: 2, interval: 6, easeFactor: 2.5 }), {
      correct: true,
      now,
    });
    expect(next.repetition).toBe(3);
    expect(next.interval).toBe(15);
  });

  it('列12 小数点以下ちょうど0.5は切り上げる', () => {
    // interval 5 × EF 1.5 = 7.5 → 8
    const next = updateSrs(state({ repetition: 3, interval: 5, easeFactor: 1.5 }), {
      correct: true,
      now,
    });
    expect(next.interval).toBe(8);
  });

  it('列4 不正解は repetition を0に戻し間隔を1日にする', () => {
    const next = updateSrs(state({ repetition: 4, interval: 30 }), { correct: false, now });
    expect(next.repetition).toBe(0);
    expect(next.interval).toBe(1);
    expect(daysUntil(next.dueAt)).toBe(1);
  });

  it('列14 何回続いていてもリセットし、EF は計算結果を使う', () => {
    const next = updateSrs(state({ repetition: 5, interval: 60, easeFactor: 2.5 }), {
      correct: false,
      now,
    });
    expect(next.repetition).toBe(0);
    expect(next.easeFactor).toBeCloseTo(1.7, 5);
  });

  it('列5 正解の品質は5で、EF は上がる', () => {
    const next = updateSrs(state({ easeFactor: 2.5 }), { correct: true, now });
    expect(next.easeFactor).toBeCloseTo(2.6, 5);
  });

  it('列6 不正解の品質は0で、EF は下がる', () => {
    const next = updateSrs(state({ easeFactor: 2.5 }), { correct: false, now });
    expect(next.easeFactor).toBeCloseTo(1.7, 5);
  });

  it('列7 EF の下限は1.3', () => {
    const next = updateSrs(state({ easeFactor: 1.4 }), { correct: false, now });
    expect(next.easeFactor).toBe(MIN_EASE_FACTOR);
  });

  it('列13 計算結果がちょうど1.3なら1.3のまま', () => {
    // 2.1 - 0.8 = 1.3
    const next = updateSrs(state({ easeFactor: 2.1 }), { correct: false, now });
    expect(next.easeFactor).toBe(1.3);
  });

  it('列8 記録が無ければ EF 2.5 から始める', () => {
    expect(INITIAL_EASE_FACTOR).toBe(2.5);
    const next = updateSrs(null, { correct: true, now });
    expect(next.repetition).toBe(1);
    expect(next.easeFactor).toBeCloseTo(2.6, 5);
  });

  it('列15 記録があれば EF を引き継ぐ', () => {
    const next = updateSrs(state({ easeFactor: 1.8 }), { correct: true, now });
    expect(next.easeFactor).toBeCloseTo(1.9, 5);
  });

  it('列9 表示範囲を広げて解答しても SRS の計算は変わらない', () => {
    const plain = updateSrs(state(), { correct: true, now });
    const expanded = updateSrs(state(), { correct: true, now, expanded: true });
    expect(expanded).toEqual(plain);
  });

  it('列10 別解として登録したときは正解として計算し直す', () => {
    const next = updateSrs(state({ repetition: 0, interval: 1, easeFactor: 2.5 }), {
      correct: true,
      now,
    });
    expect(next.repetition).toBe(1);
    expect(next.easeFactor).toBeCloseTo(2.6, 5);
  });

  it('列16 前倒しで解答しても現在時刻を基準にする', () => {
    const next = updateSrs(state({ repetition: 1, interval: 1 }), {
      correct: true,
      now,
      dueAt: new Date('2026-09-30T00:00:00.000Z'),
    });
    expect(daysUntil(next.dueAt)).toBe(6);
  });
});
