/**
 * 次に出す問題を選ぶ。決定表「出題順」に対応する。
 * しきい値は docs/仕様書.md §5.2 を参照。
 */

/** 連続出題を避ける範囲（仕様書 §5.2）。 */
export const RECENT_LIMIT = 10;

export type Candidate = {
  keywordId: string;
  /** 章の順序・章内の出現順を1つに畳んだ位置 */
  position: number;
  /** 一度も解いていなければ null */
  dueAt: Date | null;
};

export type PickOptions = {
  order: 'auto' | 'sequential';
  /** 直近に解答したキーワード。新しいものから並んでいなくてよい */
  recent: readonly string[];
  now: Date;
  /** 同着の並べ替えに使う乱数。テストから差し替えられるようにする */
  random?: () => number;
};

/** 並べ替えのあいだだけ持つ、候補と同着用の乱数の組。 */
type Keyed = { candidate: Candidate; shuffle: number };

/**
 * 未出題 → 期限の近い順 → ランダム（列1・列2・列3・列14・列15）。
 *
 * 同着をランダムにするため、比較のたびに乱数を引かず候補ごとに1つ持たせる。
 * 引き直すと比較結果が揺れて並べ替えが壊れる。
 */
function autoOrder(a: Keyed, b: Keyed): number {
  const x = a.candidate.dueAt;
  const y = b.candidate.dueAt;
  if (x === null && y === null) return a.shuffle - b.shuffle;
  if (x === null) return -1;
  if (y === null) return 1;
  const diff = x.getTime() - y.getTime();
  return diff !== 0 ? diff : a.shuffle - b.shuffle;
}

/**
 * 次の1問を選ぶ。候補が無ければ null（列12 の終了はこれで判る）。
 *
 * 直近に出たものは飛ばすが、候補が少ないときと全部が直近に含まれるときは
 * 出題できなくなるので制限を緩める（列4・列5・列9・列10）。
 */
export function pickNext(
  candidates: readonly Candidate[],
  { order, recent, random = Math.random }: PickOptions,
): Candidate | null {
  if (candidates.length === 0) return null;

  const keyed: Keyed[] = candidates.map((candidate) => ({ candidate, shuffle: random() }));
  const sorted = keyed
    .sort(order === 'auto' ? autoOrder : (a, b) => a.candidate.position - b.candidate.position)
    .map((k) => k.candidate);

  const avoid = new Set(recent.slice(-RECENT_LIMIT));
  const relaxed = candidates.length < RECENT_LIMIT;
  if (!relaxed) {
    const picked = sorted.find((c) => !avoid.has(c.keywordId));
    if (picked) return picked;
  }

  return sorted[0] ?? null;
}
