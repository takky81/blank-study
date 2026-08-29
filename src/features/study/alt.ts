/**
 * 別解の登録。決定表「別解の登録」に対応する。
 * 覆すのはその回の判定だけで、それ以前の解答履歴はさかのぼらない（列4）。
 */

import { isAnswerable, judge } from '@/lib/answer';
import type { AnswerFormat } from './question';

/**
 * 別解の導線を出してよいか。
 * 選択肢で選んだ語は他のキーワードの正答なので、別解にはしない（列8）。
 */
export function canRegisterAlt(state: {
  correct: boolean;
  format: AnswerFormat;
  input: string;
}): boolean {
  if (state.correct) return false;
  if (state.format === 'choice') return false;
  return isAnswerable(state.input);
}

/** 正答に追加する。正規化して一致するものがあれば増やさない（列5）。 */
export function addAlternative(answers: readonly string[], input: string): string[] {
  const value = input.trim();
  if (!isAnswerable(value)) return [...answers];
  if (judge(value, answers)) return [...answers];
  return [...answers, value];
}
