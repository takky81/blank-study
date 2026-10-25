import { describe, expect, it } from 'vitest';

import { binAccuracy, binAskedCount, type DistributionPoint } from './histogram';

const point = (askedCount: number, correctCount: number): DistributionPoint => ({ askedCount, correctCount });
const countOf = (bins: readonly { label: string; count: number }[], label: string) =>
  bins.find((bin) => bin.label === label)?.count;

describe('binAccuracy', () => {
  it('常に13階級を正規順で返す', () => {
    const labels = binAccuracy([]).map((bin) => bin.label);
    expect(labels).toEqual([
      '未出題', '0%', '0%超10%未満',
      '10%以上20%未満', '20%以上30%未満', '30%以上40%未満', '40%以上50%未満', '50%以上60%未満',
      '60%以上70%未満', '70%以上80%未満', '80%以上90%未満', '90%以上100%未満', '100%',
    ]);
  });

  it('未出題・0%・100%を独立した階級に数える', () => {
    const bins = binAccuracy([point(0, 0), point(3, 0), point(4, 4)]);
    expect(countOf(bins, '未出題')).toBe(1);
    expect(countOf(bins, '0%')).toBe(1);
    expect(countOf(bins, '100%')).toBe(1);
    expect(countOf(bins, '0%超10%未満')).toBe(0);
  });

  it('境界値をその階級の下限側に含める', () => {
    const bins = binAccuracy([
      point(10, 1), point(10, 9), point(3, 1), point(3, 2), point(100, 99), point(100, 1), point(101, 1),
    ]);
    expect(countOf(bins, '10%以上20%未満')).toBe(1);
    expect(countOf(bins, '90%以上100%未満')).toBe(2);
    expect(countOf(bins, '30%以上40%未満')).toBe(1);
    expect(countOf(bins, '60%以上70%未満')).toBe(1);
    expect(countOf(bins, '0%超10%未満')).toBe(2);
  });

  it('件数合計が入力件数と一致する', () => {
    const points = Array.from({ length: 57 }, (_, index) => point(index % 7, index % 5 === 0 ? 0 : Math.min(index % 7, 2)));
    expect(binAccuracy(points).reduce((sum, bin) => sum + bin.count, 0)).toBe(57);
  });
});

describe('binAskedCount', () => {
  it('空入力では空配列を返す', () => {
    expect(binAskedCount([])).toEqual([]);
  });

  it('0回から最大回数まで1回刻みで、欠番も0件で返す', () => {
    expect(binAskedCount([point(0, 0), point(3, 1), point(3, 3)])).toEqual([
      { label: '0回', count: 1 },
      { label: '1回', count: 0 },
      { label: '2回', count: 0 },
      { label: '3回', count: 2 },
    ]);
  });

  it('件数合計が入力件数と一致する', () => {
    const points = Array.from({ length: 40 }, (_, index) => point(index % 13, 0));
    expect(binAskedCount(points).reduce((sum, bin) => sum + bin.count, 0)).toBe(40);
  });
});
