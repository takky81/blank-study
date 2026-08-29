import { describe, it, expect } from 'vitest';
import { normalizeAnswer, isAnswerable, judge } from './answer';

// 決定表「正誤判定」 spec/tables/16-judge.jsonl
describe('正誤判定', () => {
  const answers = ['ビット', 'bit'];

  it('列1 judge: 完全一致は正解', () => {
    expect(judge('ビット', answers)).toBe(true);
  });

  it('列2 normalizeInput: 前後の空白を除去する', () => {
    expect(normalizeAnswer('  ビット  ')).toBe('ビット');
    expect(judge('  ビット  ', answers)).toBe(true);
  });

  it('列3 normalizeInput: 全角を半角に寄せる', () => {
    expect(normalizeAnswer('ｂｉｔ')).toBe('bit');
    expect(judge('ｂｉｔ', answers)).toBe(true);
  });

  it('列4 normalizeInput: 大文字小文字を同一視する', () => {
    expect(judge('BIT', answers)).toBe(true);
    expect(judge('Bit', answers)).toBe(true);
  });

  it('列5 judge: 別解も正解として扱う', () => {
    expect(judge('bit', answers)).toBe(true);
  });

  it('列6 judge: 一致しなければ不正解', () => {
    expect(judge('バイト', answers)).toBe(false);
  });

  it('列8 judge: 空入力は解答にしない', () => {
    expect(isAnswerable('')).toBe(false);
  });

  it('列11 judge: 空白だけの入力を解答にしない', () => {
    expect(isAnswerable('   ')).toBe(false);
    expect(isAnswerable('　')).toBe(false);
    expect(judge('   ', ['   '])).toBe(false);
  });

  it('列12 judge: 正答も正規化してから比べる', () => {
    expect(judge('ビット', ['  ビット  '])).toBe(true);
  });

  it('列13 normalizeInput: 混在を寄せる', () => {
    expect(normalizeAnswer('ＣＰＵ1')).toBe('cpu1');
  });

  it('列14 judge: 読みの違いは吸収しない', () => {
    expect(judge('びっと', answers)).toBe(false);
  });

  it('列15 judge: 部分一致は正解にしない', () => {
    expect(judge('ビ', answers)).toBe(false);
    expect(judge('ビットです', answers)).toBe(false);
  });
});
