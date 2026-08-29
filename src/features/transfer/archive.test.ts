import { describe, it, expect } from 'vitest';
import { encodeZip, decodeZip, zipFileName } from './archive';

describe('zip の読み書き（決定表「インポートの単位」列5）', () => {
  it('書き出した zip をそのまま読み直せる', () => {
    const files = { '010_基礎理論/index.md': '# 基礎理論', '020_章.md': '本文' };
    expect(decodeZip(encodeZip(files))).toEqual(files);
  });

  it('列5 壊れた zip は読み込めないものとして扱う', () => {
    expect(() => decodeZip(new Uint8Array([1, 2, 3, 4]))).toThrow(/読み込めません/);
  });

  it('zip のファイル名は教材名にする', () => {
    expect(zipFileName('テクノロジ系')).toBe('テクノロジ系.zip');
    expect(zipFileName('入出力/装置')).toBe('入出力_装置.zip');
  });
});
