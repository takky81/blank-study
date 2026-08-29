import { describe, it, expect } from 'vitest';
import { canRegisterAlt, addAlternative } from './alt';

describe('別解の登録（決定表「別解の登録」）', () => {
  it('列3 正解のときは導線を出さない', () => {
    expect(canRegisterAlt({ correct: true, format: 'text', input: '光合成' })).toBe(false);
  });

  it('列1 不正解の記述式なら出す', () => {
    expect(canRegisterAlt({ correct: false, format: 'text', input: '炭酸同化' })).toBe(true);
  });

  it('列8 選択肢では出さない', () => {
    expect(canRegisterAlt({ correct: false, format: 'choice', input: '呼吸' })).toBe(false);
  });

  it('空の入力は別解にできない', () => {
    expect(canRegisterAlt({ correct: false, format: 'text', input: '  ' })).toBe(false);
  });

  it('列1 正答の末尾に追加する', () => {
    expect(addAlternative(['光合成'], '炭酸同化')).toEqual(['光合成', '炭酸同化']);
  });

  it('列5 正規化して一致するものは追加しない', () => {
    expect(addAlternative(['CPU'], ' ｃｐｕ ')).toEqual(['CPU']);
  });

  it('列5 同じ入力を二度登録しても増えない', () => {
    expect(addAlternative(addAlternative(['光合成'], '同化'), '同化')).toEqual(['光合成', '同化']);
  });
});
