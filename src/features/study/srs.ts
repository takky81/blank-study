/**
 * SM-2 相当の間隔反復。決定表「SRS の更新」に対応する。
 * 式と定数は docs/仕様書.md §5.1 / §5.2 を参照。
 */

export const INITIAL_EASE_FACTOR = 2.5;
export const MIN_EASE_FACTOR = 1.3;

const DAY_MS = 86400000;

export type SrsState = {
  repetition: number;
  interval: number;
  easeFactor: number;
};

export type SrsResult = SrsState & { dueAt: Date };

/** 小数点以下 0.5 は切り上げる（仕様書 §5.1）。 */
function round(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * 解答1件を反映した次の状態を返す。
 * 表示範囲を広げたかどうかは計算に影響しない（列9）。
 * 別解として登録したときは正解として呼び直す（列10）。
 */
export function updateSrs(
  current: SrsState | null,
  answer: { correct: boolean; now: Date; expanded?: boolean; dueAt?: Date },
): SrsResult {
  const state = current ?? { repetition: 0, interval: 0, easeFactor: INITIAL_EASE_FACTOR };
  const quality = answer.correct ? 5 : 0;

  const raw = state.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  // 浮動小数の端数で下限を割り込まないよう、丸めてから比べる
  const easeFactor = Math.max(MIN_EASE_FACTOR, Math.round(raw * 1e10) / 1e10);

  const repetition = answer.correct ? state.repetition + 1 : 0;
  let interval: number;
  if (!answer.correct) interval = 1;
  else if (repetition === 1) interval = 1;
  else if (repetition === 2) interval = 6;
  // 掛けるのは更新前の EF（決定表「SRS の更新」列11: interval 6 ・ EF 2.5 → 15）
  else interval = round(state.interval * state.easeFactor);

  // 前倒しで解答しても、次回は現在時刻を基準にする（列16）
  return {
    repetition,
    interval,
    easeFactor,
    dueAt: new Date(answer.now.getTime() + interval * DAY_MS),
  };
}
