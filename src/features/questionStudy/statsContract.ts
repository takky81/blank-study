/**
 * 下流consumer向けの設問学習統計read contract。
 * supabaseに依存しない純粋な集計だけを置き、穴埋め統計は扱わない。
 */
export type KeywordQuestionStudyAggregate = Readonly<{
  keywordId: string;
  attempts: number;
  correct: number;
  wrong: number;
  /** attempts が0（未出題）のときは null。 */
  accuracy: number | null;
  /** 有効な設問の件数。 */
  questionCount: number;
}>;

export type AggregatableQuestion = Readonly<{ id: string; keywordId: string; isActive: boolean }>;
export type AggregatableQuestionStats = Readonly<{ questionId: string; askedCount: number; correctCount: number }>;

/** 有効設問だけをkeyword単位で集計し、keywordId順で返す。statsなしの設問は0件として数える。 */
export function aggregateKeywordQuestionStudy(
  questions: readonly AggregatableQuestion[],
  stats: readonly AggregatableQuestionStats[],
): KeywordQuestionStudyAggregate[] {
  const statsById = new Map<string, AggregatableQuestionStats>();
  for (const row of stats) if (!statsById.has(row.questionId)) statsById.set(row.questionId, row);

  const totals = new Map<string, { attempts: number; correct: number; questionCount: number }>();
  const seen = new Set<string>();
  for (const question of questions) {
    if (!question.isActive || seen.has(question.id)) continue;
    seen.add(question.id);
    const total = totals.get(question.keywordId) ?? { attempts: 0, correct: 0, questionCount: 0 };
    const row = statsById.get(question.id);
    total.attempts += row?.askedCount ?? 0;
    total.correct += row?.correctCount ?? 0;
    total.questionCount += 1;
    totals.set(question.keywordId, total);
  }

  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([keywordId, { attempts, correct, questionCount }]) => ({
      keywordId,
      attempts,
      correct,
      wrong: attempts - correct,
      accuracy: attempts === 0 ? null : correct / attempts,
      questionCount,
    }));
}
