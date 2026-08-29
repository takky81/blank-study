import { describe, it, expect } from 'vitest';
import { isValidName, normalizeName, reorder } from './validation';

// 決定表「科目の管理」 spec/tables/02-subject.jsonl
describe('科目の管理', () => {
  it('列1 createSubject: 名前があれば追加できる', () => {
    expect(isValidName('基本情報技術者')).toBe(true);
  });

  it('列2 createSubject: 空の名前を弾く', () => {
    expect(isValidName('')).toBe(false);
  });

  it('列3 createSubject: 空白だけの名前を弾く', () => {
    expect(isValidName('   ')).toBe(false);
    expect(isValidName('　')).toBe(false);
  });

  it('列4 createSubject: 名前の重複を許す', () => {
    // 名前の一意性は検査しない。同じ名前でも受け付ける
    expect(isValidName('基本情報技術者')).toBe(true);
  });

  it('前後の空白を落として保存する', () => {
    expect(normalizeName('  基本情報  ')).toBe('基本情報');
  });

  it('列10 reorder: 並べ替えた順序を返す', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('列10 reorder: 範囲外や同じ位置は並びを変えない', () => {
    expect(reorder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(reorder(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
    expect(reorder(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});
