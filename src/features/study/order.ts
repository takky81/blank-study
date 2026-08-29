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
};

/** 未出題 → 期限の近い順 → 出現順（列1・列2・列3・列14・列15）。 */
function autoOrder(a: Candidate, b: Candidate): number {
  if (a.dueAt === null && b.dueAt === null) return a.position - b.position;
  if (a.dueAt === null) return -1;
  if (b.dueAt === null) return 1;
  const diff = a.dueAt.getTime() - b.dueAt.getTime();
  return diff !== 0 ? diff : a.position - b.position;
}

/**
 * 次の1問を選ぶ。候補が無ければ null（列12 の終了はこれで判る）。
 *
 * 直近に出たものは飛ばすが、候補が少ないときと全部が直近に含まれるときは
 * 出題できなくなるので制限を緩める（列4・列5・列9・列10）。
 */
export function pickNext(
  candidates: readonly Candidate[],
  { order, recent }: PickOptions,
): Candidate | null {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort(
    order === 'auto' ? autoOrder : (a, b) => a.position - b.position,
  );

  const avoid = new Set(recent.slice(-RECENT_LIMIT));
  const relaxed = candidates.length < RECENT_LIMIT;
  if (!relaxed) {
    const picked = sorted.find((c) => !avoid.has(c.keywordId));
    if (picked) return picked;
  }

  return sorted[0] ?? null;
}
