/**
 * 構造化設問の出題形式・選択肢・正誤判定のadapter。
 * しきい値と正規化は上流（@/features/study/question, @/lib/answer）に委譲し、ここでは複製しない。
 */

import { decideFormat, judgeChoice, UNKNOWN_CHOICE_LABEL, type ChoiceSelection } from '@/features/study/question';
import { isAnswerable, judge, normalizeAnswer } from '@/lib/answer';

import type { QuestionStudyStats } from './candidates';

export type RequestedQuestionMode = 'auto' | 'choice' | 'written';
export type ResolvedQuestionMode = 'choice' | 'written';

export type QuestionChoiceOption = Readonly<{ value: string; isModelAnswer: boolean }>;
export type QuestionChoiceOptions = Readonly<{
  /** 模範解答（先頭に1回）と重複しない登録選択肢（登録順）。 */
  options: readonly QuestionChoiceOption[];
  /** 模範解答以外の選択肢。resolveQuestionMode に渡す。 */
  distractors: readonly string[];
  /** 回答候補と区別される固定の「わからない」。 */
  unknown: Readonly<{ label: string; unknown: true }>;
}>;

function distinctChoices(choices: readonly string[], excluded: ReadonlySet<string>): string[] {
  const seen = new Set(excluded);
  const result: string[] = [];
  for (const value of choices) {
    const key = normalizeAnswer(value);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * 出題形式を決める。choices は模範解答以外の登録選択肢。
 * 専用統計なしは未出題として上流規則へ渡すため選択式、選択肢不足は記述式になる。
 */
export function resolveQuestionMode(
  requested: RequestedQuestionMode,
  stats: QuestionStudyStats | null,
  choices: readonly string[],
): ResolvedQuestionMode {
  const format = decideFormat(requested === 'written' ? 'text' : requested, {
    totalCount: stats?.askedCount ?? 0,
    correctCount: stats?.correctCount ?? 0,
    wrongCount: distinctChoices(choices, new Set()).length,
  });
  return format === 'text' ? 'written' : 'choice';
}

export function buildQuestionChoiceOptions(
  modelAnswer: string,
  choices: readonly string[],
): QuestionChoiceOptions {
  const distractors = distinctChoices(choices, new Set([normalizeAnswer(modelAnswer)]));
  return {
    options: [
      { value: modelAnswer, isModelAnswer: true },
      ...distractors.map((value) => ({ value, isModelAnswer: false })),
    ],
    distractors,
    unknown: { label: UNKNOWN_CHOICE_LABEL, unknown: true },
  };
}

/** 空欄・空白だけの記述回答は確定させない。 */
export function canSubmitWrittenAnswer(answer: string): boolean {
  return isAnswerable(answer);
}

/** 共通正規化後の模範解答との完全一致だけで判定する。 */
export function judgeQuestionAnswer(answer: string, modelAnswer: string): boolean {
  return judge(answer, [modelAnswer]);
}

/** 固定の「わからない」は常に不正解。 */
export function judgeQuestionChoice(selection: ChoiceSelection, modelAnswer: string): boolean {
  return judgeChoice(selection, [modelAnswer]);
}
