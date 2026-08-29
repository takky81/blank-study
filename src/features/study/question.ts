/**
 * 出題する形式と選択肢を決める。
 * 決定表「解答形式の決定」「選択肢の生成」に対応する。
 * しきい値は docs/仕様書.md §5.2 を参照。
 */

import { normalizeAnswer } from '@/lib/answer';

/** 定着とみなす出題回数と正答率（仕様書 §5.2）。 */
export const SETTLED_COUNT = 3;
export const SETTLED_RATE = 0.9;
/** 選択肢の数。正答1 + 誤答3。 */
export const CHOICE_COUNT = 4;

export type AnswerFormat = 'choice' | 'text';
export type FormatSetting = 'auto' | 'choice' | 'text';

export type FormatInput = {
  totalCount: number;
  correctCount: number;
  /** 組み立てられた誤答の数 */
  wrongCount: number;
};

/**
 * 出題形式を決める。
 * 誤答が1件も作れないときは選択肢にできないので記述にする（列6）。
 */
export function decideFormat(setting: FormatSetting, input: FormatInput): AnswerFormat {
  if (setting === 'text') return 'text';
  if (input.wrongCount === 0) return 'text';
  if (setting === 'choice') return 'choice';

  // 未出題は正答率が出せないので定着とみなさない（列10）
  if (input.totalCount < SETTLED_COUNT) return 'choice';
  const rate = input.correctCount / input.totalCount;
  return rate >= SETTLED_RATE ? 'text' : 'choice';
}

/** 共通するタグが1つでもあれば同じタグとみなす（列7・列13）。 */
export function sameTag(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((tag) => set.has(tag));
}

export type ChoiceSource = {
  keywordId: string;
  answers: string[];
  tags: string[];
  /** 出題中の章からの距離。同じ章が0、遠いほど大きい */
  distance: number;
  isActive: boolean;
};

export type Question = {
  keywordId?: string;
  answers: string[];
  tags: string[];
  wrongChoices: string[];
};

export type BuiltChoices = {
  correct: string;
  choices: string[];
  /** 誤答が集まらなければ記述に切り替える（列5） */
  format: AnswerFormat;
};

/** 無作為に並べ替える。乱数は差し替えられるようにして試験で固定する。 */
function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * 選択肢を組み立てる。
 * wrong_choices を先に使い、足りない分を同じタグのキーワードから
 * 章の近い順に補う（列1・列2・列3）。
 */
export function buildChoices(
  question: Question,
  sources: readonly ChoiceSource[],
  random: () => number = Math.random,
): BuiltChoices {
  const correct = question.answers[0] ?? '';
  // 別解も含めて、正答と重なる誤答は使わない（列10）
  const excluded = new Set(question.answers.map(normalizeAnswer));

  const wrong: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const key = normalizeAnswer(value);
    if (key === '' || excluded.has(key) || seen.has(key)) return;
    seen.add(key);
    wrong.push(value);
  };

  for (const value of question.wrongChoices) add(value);

  if (wrong.length < CHOICE_COUNT - 1) {
    const usable = sources
      .filter((s) => s.isActive)
      .filter((s) => s.keywordId !== question.keywordId)
      .filter((s) => sameTag(s.tags, question.tags))
      .sort((a, b) => a.distance - b.distance);

    // 同じ距離のものは無作為に選ぶ（列9）
    const grouped = new Map<number, ChoiceSource[]>();
    for (const item of usable) {
      const found = grouped.get(item.distance) ?? [];
      found.push(item);
      grouped.set(item.distance, found);
    }
    for (const distance of [...grouped.keys()].sort((a, b) => a - b)) {
      for (const item of shuffle(grouped.get(distance) ?? [], random)) {
        if (wrong.length >= CHOICE_COUNT - 1) break;
        add(item.answers[0] ?? '');
      }
    }
  }

  const picked = wrong.slice(0, CHOICE_COUNT - 1);
  if (picked.length === 0) return { correct, choices: [], format: 'text' };

  return {
    correct,
    // 正答の位置は毎回変える（列12）
    choices: shuffle([correct, ...picked], random),
    format: 'choice',
  };
}
