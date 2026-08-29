import { describe, it, expect } from 'vitest';
import {
  classify,
  aggregate,
  weakKeywords,
  dailyVolume,
  type StatRow,
} from './aggregate';

// 端末の時刻で日と週を区切るので、ローカル時刻で組み立てる（2026-08-26 は水曜日）
const now = new Date(2026, 7, 26, 12, 0, 0);
const local = (month: number, day: number, hour = 9) => new Date(2026, month - 1, day, hour);

function row(over: Partial<StatRow> = {}): StatRow {
  return {
    keywordId: 'k1',
    answers: ['光合成'],
    chapterId: 'c1',
    isActive: true,
    totalCount: 0,
    correctCount: 0,
    dueAt: null,
    ...over,
  };
}

describe('classify（決定表「学習履歴の集計」列1・列2・列3・列4）', () => {
  it('列1 記録が無ければ未出題', () => {
    expect(classify(row())).toBe('untouched');
  });

  it('列2 3回以上で90%以上なら定着', () => {
    expect(classify(row({ totalCount: 10, correctCount: 10 }))).toBe('settled');
  });

  it('列3 出題はあるが届かなければ苦手', () => {
    expect(classify(row({ totalCount: 5, correctCount: 2 }))).toBe('weak');
  });

  it('列4 ちょうど3回・ちょうど90%は定着に入れる', () => {
    expect(classify(row({ totalCount: 10, correctCount: 9 }))).toBe('settled');
    expect(classify(row({ totalCount: 3, correctCount: 3 }))).toBe('settled');
  });
});

describe('aggregate（決定表「学習履歴の集計」列5-列12）', () => {
  it('列5 内訳と総問題数・正答率を出す', () => {
    const summary = aggregate(
      [
        row({ keywordId: 'a', totalCount: 10, correctCount: 10 }),
        row({ keywordId: 'b', totalCount: 4, correctCount: 1 }),
        row({ keywordId: 'c' }),
      ],
      now,
    );
    expect(summary).toMatchObject({ total: 3, settled: 1, weak: 1, untouched: 1 });
    expect(summary.correctRate).toBeCloseTo(11 / 14, 5);
  });

  it('列7 非活性のキーワードは数えない', () => {
    const summary = aggregate([row({ isActive: false, totalCount: 3, correctCount: 3 })], now);
    expect(summary.total).toBe(0);
  });

  it('列8 キーワードが0件なら正答率を出さない', () => {
    const summary = aggregate([], now);
    expect(summary.total).toBe(0);
    expect(summary.correctRate).toBeNull();
  });

  it('列9 出題が0回なら正答率を出さず、すべて未出題にする', () => {
    const summary = aggregate([row(), row({ keywordId: 'b' })], now);
    expect(summary.correctRate).toBeNull();
    expect(summary.untouched).toBe(2);
  });

  it('列10 正答率は正答回数 ÷ 出題回数', () => {
    const summary = aggregate([row({ totalCount: 4, correctCount: 3 })], now);
    expect(summary.correctRate).toBe(0.75);
  });

  it('列11 今日の復習予定は期限が今日の終わりまでのものと未出題', () => {
    const summary = aggregate(
      [
        row({ keywordId: 'a', dueAt: local(8, 26, 23), totalCount: 1 }),
        row({ keywordId: 'b', dueAt: local(8, 27), totalCount: 1 }),
        row({ keywordId: 'c' }),
      ],
      now,
    );
    expect(summary.dueToday).toBe(2);
  });

  it('列12 今週の復習予定は週の終わりまでのもの', () => {
    const summary = aggregate(
      [
        row({ keywordId: 'a', dueAt: local(8, 28), totalCount: 1 }),
        row({ keywordId: 'b', dueAt: local(9, 20), totalCount: 1 }),
      ],
      now,
    );
    expect(summary.dueThisWeek).toBe(1);
  });

  it('列6 上位の集計は配下の合計になる', () => {
    const rows = [
      row({ keywordId: 'a', chapterId: 'c1', totalCount: 3, correctCount: 3 }),
      row({ keywordId: 'b', chapterId: 'c2', totalCount: 2, correctCount: 0 }),
    ];
    const parent = aggregate(rows, now);
    const left = aggregate(rows.filter((r) => r.chapterId === 'c1'), now);
    const right = aggregate(rows.filter((r) => r.chapterId === 'c2'), now);
    expect(parent.total).toBe(left.total + right.total);
    expect(parent.settled).toBe(left.settled + right.settled);
  });

  it('列19 別解の登録で覆したあとの値をそのまま数える', () => {
    const summary = aggregate([row({ totalCount: 1, correctCount: 1 })], now);
    expect(summary.correctRate).toBe(1);
  });
});

describe('weakKeywords（決定表「学習履歴の集計」列13・列14）', () => {
  it('列13 正答率の低い順に並べ、未出題は含めない', () => {
    const list = weakKeywords([
      row({ keywordId: 'a', answers: ['A'], totalCount: 4, correctCount: 3 }),
      row({ keywordId: 'b', answers: ['B'], totalCount: 4, correctCount: 1 }),
      row({ keywordId: 'c', answers: ['C'] }),
    ]);
    expect(list.map((k) => k.keywordId)).toEqual(['b', 'a']);
  });

  it('列14 正答率が同じなら出題回数の多い方を先に出す', () => {
    const list = weakKeywords([
      row({ keywordId: 'a', totalCount: 2, correctCount: 1 }),
      row({ keywordId: 'b', totalCount: 10, correctCount: 5 }),
    ]);
    expect(list.map((k) => k.keywordId)).toEqual(['b', 'a']);
  });

  it('非活性のキーワードは並べない', () => {
    expect(weakKeywords([row({ isActive: false, totalCount: 2, correctCount: 0 })])).toEqual([]);
  });
});

describe('dailyVolume（決定表「学習履歴の集計」列15・列16）', () => {
  it('列15 日ごとに解答数と正答率を出す', () => {
    const days = dailyVolume(
      [
        { answeredAt: local(8, 26, 1), correct: true },
        { answeredAt: local(8, 26, 2), correct: false },
      ],
      now,
      1,
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ count: 2, correctRate: 0.5 });
  });

  it('列16 解答が無い日も0として並べる', () => {
    const days = dailyVolume([], now, 3);
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.count === 0)).toBe(true);
    expect(days[0]?.correctRate).toBeNull();
  });

  it('列16 並びは古い日から新しい日へ', () => {
    const days = dailyVolume([], now, 3);
    expect(days.map((d) => d.date)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });
});
