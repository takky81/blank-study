/**
 * 成績分布ヒストグラムの階級化規則（純粋関数）。
 * 正答率は浮動小数の誤差で境界がずれないよう、正解数と出題数の整数演算で振り分ける。
 */

/** 集計対象1件。askedCount が0なら未出題。 */
export type DistributionPoint = Readonly<{ askedCount: number; correctCount: number }>;

export type HistogramBin = Readonly<{ label: string; count: number }>;

const ACCURACY_LABELS: readonly string[] = [
  '未出題',
  '0%',
  '0%超10%未満',
  ...Array.from({ length: 9 }, (_, index) => `${(index + 1) * 10}%以上${(index + 2) * 10}%未満`),
  '100%',
];

/** 未出題, 0%, 0%超10%未満, 10%以上20%未満 … 90%以上100%未満, 100% の13階級。 */
export function binAccuracy(points: readonly DistributionPoint[]): readonly HistogramBin[] {
  const counts = ACCURACY_LABELS.map(() => 0);
  for (const point of points) {
    const index = accuracyBinIndex(point);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return ACCURACY_LABELS.map((label, index) => ({ label, count: counts[index] ?? 0 }));
}

function accuracyBinIndex({ askedCount, correctCount }: DistributionPoint): number {
  if (askedCount === 0) return 0;
  if (correctCount === 0) return 1;
  if (correctCount >= askedCount) return ACCURACY_LABELS.length - 1;
  // 0%超100%未満を10%刻みにする。floor(correct*10/asked) は 0〜9。
  return 2 + Math.floor((correctCount * 10) / askedCount);
}

/** 0回〜最大出題回数の1回刻み。該当0件の回も含め、空入力は空配列。 */
export function binAskedCount(points: readonly DistributionPoint[]): readonly HistogramBin[] {
  if (points.length === 0) return [];
  const max = points.reduce((value, point) => Math.max(value, point.askedCount), 0);
  const counts = Array.from({ length: max + 1 }, () => 0);
  for (const point of points) counts[point.askedCount] = (counts[point.askedCount] ?? 0) + 1;
  return counts.map((count, asked) => ({ label: `${asked}回`, count }));
}
