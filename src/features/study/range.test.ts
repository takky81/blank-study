import { describe, it, expect } from 'vitest';
import { viewOfBlank, defaultRange, expandRange, canExpandRange, type ViewContext } from './range';

const keywords = new Map([
  ['a3f9k2', { answers: ['光合成'], tags: ['生物', '理科'] }],
  ['w4d8x1', { answers: ['呼吸'], tags: ['理科', '生物'] }],
  ['zzzzzz', { answers: ['CPU'], tags: ['情報'] }],
  ['nnnnnn', { answers: ['タグ無し'], tags: [] }],
]);

function context(over: Partial<ViewContext> = {}): ViewContext {
  return {
    phase: 'answering',
    currentDocId: 'a3f9k2',
    keywords,
    ...over,
  };
}

describe('viewOfBlank（決定表「表示範囲内のキーワードの表示」）', () => {
  it('列1 解答中の出題キーワードは入力欄にする', () => {
    expect(viewOfBlank('a3f9k2', context())).toEqual({
      display: 'input',
      text: '',
      color: 'yellow',
    });
  });

  it('列2・列13 同じタグの他のキーワードは共通タグで伏せる', () => {
    expect(viewOfBlank('w4d8x1', context())).toEqual({
      display: 'text',
      text: '〈生物〉',
      color: 'gray',
    });
  });

  it('列3 タグが違えばそのまま出す', () => {
    expect(viewOfBlank('zzzzzz', context())).toEqual({
      display: 'text',
      text: 'CPU',
      color: 'none',
    });
  });

  it('列12 タグを持たないキーワードは伏せない', () => {
    expect(viewOfBlank('nnnnnn', context())).toEqual({
      display: 'text',
      text: 'タグ無し',
      color: 'none',
    });
  });

  it('列4 判定後の出題キーワードは正答を出す', () => {
    expect(viewOfBlank('a3f9k2', context({ phase: 'judged', correct: true }))).toEqual({
      display: 'text',
      text: '光合成',
      color: 'yellow',
    });
  });

  it('列5 不正解のとき、入力と一致するキーワードは橙にする', () => {
    expect(
      viewOfBlank('w4d8x1', context({ phase: 'judged', correct: false, input: 'こきゅう' })),
    ).toMatchObject({ color: 'gray' });
    expect(
      viewOfBlank('w4d8x1', context({ phase: 'judged', correct: false, input: '呼吸' })),
    ).toEqual({ display: 'text', text: '呼吸', color: 'orange' });
  });

  it('列5 入力の表記ゆれも同じ扱いにする', () => {
    expect(
      viewOfBlank('zzzzzz', context({ phase: 'judged', correct: false, input: ' ｃｐｕ ' })),
    ).toMatchObject({ color: 'orange' });
  });

  it('列6 判定後は伏せていた語も読めるようにする', () => {
    expect(
      viewOfBlank('w4d8x1', context({ phase: 'judged', correct: false, input: '別の語' })),
    ).toEqual({ display: 'text', text: '呼吸', color: 'gray' });
  });

  it('列7 正解のときは橙を使わない', () => {
    expect(
      viewOfBlank('w4d8x1', context({ phase: 'judged', correct: true, input: '呼吸' })),
    ).toMatchObject({ color: 'gray' });
  });

  it('列15 どのキーワードとも一致しなければ橙は出ない', () => {
    for (const docId of keywords.keys()) {
      const view = viewOfBlank(
        docId,
        context({ phase: 'judged', correct: false, input: 'まったく別' }),
      );
      expect(view.color).not.toBe('orange');
    }
  });

  it('登録の無い id は空欄のままにする', () => {
    expect(viewOfBlank('missing', context())).toMatchObject({ display: 'text', text: '' });
  });
});

describe('表示範囲の広げ方（決定表「表示範囲内のキーワードの表示」列8・列9・列10）', () => {
  it('列8 既定は出題中のキーワードを含む章', () => {
    expect(defaultRange()).toBe(0);
  });

  it('列9 1段ずつ広げる', () => {
    expect(expandRange(0, 2)).toBe(1);
    expect(expandRange(1, 2)).toBe(2);
  });

  it('列10 教材全体まで広げたらそれ以上は広げない', () => {
    expect(canExpandRange(2, 2)).toBe(false);
    expect(expandRange(2, 2)).toBe(2);
  });

  it('広げられるうちは広げられる', () => {
    expect(canExpandRange(0, 2)).toBe(true);
  });
});
