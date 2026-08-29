/**
 * 判定のあとに見せる、そのキーワードの成績。
 * 決定表「正誤判定」列17・列18 に対応する。
 */

export type Score = {
  correctCount: number;
  totalCount: number;
  /** 正答率。出題数で割った値 */
  rate: number;
};

/**
 * 今回の解答を含めた成績。
 * 記録前の値に今回の分を足して出すので、記録の反映を待たずに見せられる。
 */
export function keywordScore(
  stats: { totalCount: number; correctCount: number } | null | undefined,
  correct: boolean,
): Score {
  const totalCount = (stats?.totalCount ?? 0) + 1;
  const correctCount = (stats?.correctCount ?? 0) + (correct ? 1 : 0);
  return { correctCount, totalCount, rate: correctCount / totalCount };
}
