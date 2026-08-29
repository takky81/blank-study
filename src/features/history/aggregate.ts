/**
 * 学習履歴の集計。決定表「学習履歴の集計」に対応する。
 * 定着のしきい値は解答形式の自動判定と同じものを使う（仕様書 §5.2）。
 */

import { SETTLED_COUNT, SETTLED_RATE } from '@/features/study/question';

export type StatRow = {
  keywordId: string;
  answers: string[];
  chapterId: string | null;
  isActive: boolean;
  totalCount: number;
  correctCount: number;
  dueAt: Date | null;
};

export type Level = 'untouched' | 'weak' | 'settled';

export type Summary = {
  total: number;
  untouched: number;
  weak: number;
  settled: number;
  /** 出題が1回も無ければ出さない（列8・列9） */
  correctRate: number | null;
  dueToday: number;
  dueThisWeek: number;
};

/** 達成度の区分（列1-列4）。 */
export function classify(row: StatRow): Level {
  if (row.totalCount === 0) return 'untouched';
  const rate = row.correctCount / row.totalCount;
  return row.totalCount >= SETTLED_COUNT && rate >= SETTLED_RATE ? 'settled' : 'weak';
}

function endOfDay(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** 週の終わり（日曜はじまりの週の土曜の終わり）。 */
function endOfWeek(now: Date): Date {
  const end = endOfDay(now);
  end.setDate(end.getDate() + (6 - end.getDay()));
  return end;
}

/**
 * 章や教材ひとまとまりの集計（列5-列12）。
 * 非活性のキーワードは対象に含めない（列7）。
 */
export function aggregate(rows: readonly StatRow[], now: Date): Summary {
  const active = rows.filter((r) => r.isActive);

  const totalAnswers = active.reduce((sum, r) => sum + r.totalCount, 0);
  const totalCorrect = active.reduce((sum, r) => sum + r.correctCount, 0);

  const today = endOfDay(now).getTime();
  const week = endOfWeek(now).getTime();
  // 未出題は期限切れと同じ扱いで数える（列11）
  const dueBy = (limit: number) =>
    active.filter((r) => (r.dueAt === null ? true : r.dueAt.getTime() <= limit)).length;

  return {
    total: active.length,
    untouched: active.filter((r) => classify(r) === 'untouched').length,
    weak: active.filter((r) => classify(r) === 'weak').length,
    settled: active.filter((r) => classify(r) === 'settled').length,
    correctRate: totalAnswers === 0 ? null : totalCorrect / totalAnswers,
    dueToday: dueBy(today),
    dueThisWeek: dueBy(week),
  };
}

/** 苦手キーワード。正答率の低い順、同じなら出題回数の多い順（列13・列14）。 */
export function weakKeywords(rows: readonly StatRow[]): StatRow[] {
  return rows
    .filter((r) => r.isActive && r.totalCount > 0)
    .sort((a, b) => {
      const rate = a.correctCount / a.totalCount - b.correctCount / b.totalCount;
      return rate !== 0 ? rate : b.totalCount - a.totalCount;
    });
}

export type DayVolume = {
  date: string;
  count: number;
  correctRate: number | null;
};

/** 日付を YYYY-MM-DD にする。端末の時刻で日をまたぐ。 */
function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 日別の学習量（列15・列16）。
 * 解答が無い日も0として並べ、日ごとの増減が見えるようにする。
 */
export function dailyVolume(
  logs: readonly { answeredAt: Date; correct: boolean }[],
  now: Date,
  days: number,
): DayVolume[] {
  const buckets = new Map<string, { count: number; correct: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    buckets.set(dateKey(date), { count: 0, correct: 0 });
  }

  for (const log of logs) {
    const bucket = buckets.get(dateKey(log.answeredAt));
    if (!bucket) continue;
    bucket.count += 1;
    if (log.correct) bucket.correct += 1;
  }

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    count: bucket.count,
    correctRate: bucket.count === 0 ? null : bucket.correct / bucket.count,
  }));
}
