import { describe, it, expect } from 'vitest';
import {
  decideFormat,
  buildChoices,
  sameTag,
  CHOICE_COUNT,
  SETTLED_COUNT,
  SETTLED_RATE,
  type ChoiceSource,
} from './question';

/** 誤答の候補。章の距離が近いものから使う。 */
function source(
  text: string,
  tags: string[],
  distance: number,
  isActive = true,
): ChoiceSource {
  return { keywordId: text, answers: [text], tags, distance, isActive };
}

describe('decideFormat（決定表「解答形式の決定」）', () => {
  const settled = { totalCount: 3, correctCount: 3, wrongCount: 3 };

  it('列1 自動で定着していれば記述', () => {
    expect(decideFormat('auto', settled)).toBe('text');
  });

  it('列2 回数は足りても正答率が届かなければ選択肢', () => {
    expect(decideFormat('auto', { totalCount: 10, correctCount: 5, wrongCount: 3 })).toBe('choice');
  });

  it('列3・列8 回数が足りなければ選択肢', () => {
    expect(decideFormat('auto', { totalCount: 2, correctCount: 2, wrongCount: 3 })).toBe('choice');
  });

  it('列4 設定が選択肢なら常に選択肢', () => {
    expect(decideFormat('choice', settled)).toBe('choice');
  });

  it('列5 設定が記述なら常に記述', () => {
    expect(decideFormat('text', { totalCount: 0, correctCount: 0, wrongCount: 3 })).toBe('text');
  });

  it('列6 誤答が集まらなければ記述に切り替える', () => {
    expect(decideFormat('choice', { totalCount: 0, correctCount: 0, wrongCount: 0 })).toBe('text');
    expect(decideFormat('auto', { totalCount: 0, correctCount: 0, wrongCount: 0 })).toBe('text');
  });

  it('列7 ちょうど3回・ちょうど90%は記述', () => {
    expect(decideFormat('auto', { totalCount: 10, correctCount: 9, wrongCount: 3 })).toBe('text');
    expect(SETTLED_COUNT).toBe(3);
    expect(SETTLED_RATE).toBe(0.9);
  });

  it('列9 90%に1歩届かなければ選択肢', () => {
    expect(decideFormat('auto', { totalCount: 100, correctCount: 89, wrongCount: 3 })).toBe(
      'choice',
    );
  });

  it('列10 未出題は選択肢', () => {
    expect(decideFormat('auto', { totalCount: 0, correctCount: 0, wrongCount: 3 })).toBe('choice');
  });

  it('列11 記述の設定は誤答の有無を見ない', () => {
    expect(decideFormat('text', { totalCount: 0, correctCount: 0, wrongCount: 0 })).toBe('text');
  });
});

describe('sameTag（決定表「選択肢の生成」列7・列13）', () => {
  it('列7 共通するタグが1つでもあれば同じタグとみなす', () => {
    expect(sameTag(['生物', '理科'], ['理科', '化学'])).toBe(true);
  });

  it('列13 タグを持たなければ成立しない', () => {
    expect(sameTag([], ['理科'])).toBe(false);
    expect(sameTag(['理科'], [])).toBe(false);
  });
});

describe('buildChoices（決定表「選択肢の生成」）', () => {
  /** 並びを固定して結果を見るための擬似乱数。 */
  const noShuffle = () => 0;

  it('列1・列6 wrong_choices がそろっていればそれを使う', () => {
    const built = buildChoices(
      { answers: ['光合成', '炭酸同化'], tags: ['生物'], wrongChoices: ['呼吸', '蒸散', '発酵'] },
      [source('別の語', ['生物'], 0)],
      noShuffle,
    );
    expect(built.correct).toBe('光合成');
    expect(built.choices).toHaveLength(CHOICE_COUNT);
    expect(built.choices).toContain('光合成');
    expect(built.choices).toEqual(expect.arrayContaining(['呼吸', '蒸散', '発酵']));
  });

  it('列2 足りない分は同じ章の同じタグから補う', () => {
    const built = buildChoices(
      { answers: ['光合成'], tags: ['生物'], wrongChoices: ['呼吸'] },
      [source('蒸散', ['生物'], 0), source('発酵', ['生物'], 0)],
      noShuffle,
    );
    expect(built.choices).toEqual(expect.arrayContaining(['光合成', '呼吸', '蒸散', '発酵']));
  });

  it('列3 同じ章で足りなければ近い章から順に遡る', () => {
    const built = buildChoices(
      { answers: ['光合成'], tags: ['生物'], wrongChoices: [] },
      [source('遠い語', ['生物'], 5), source('近い語', ['生物'], 1), source('同じ章', ['生物'], 0)],
      noShuffle,
    );
    expect(built.choices).toEqual(expect.arrayContaining(['同じ章', '近い語', '遠い語']));
  });

  it('列4 集まらなければ集まった数だけで出す', () => {
    const built = buildChoices(
      { answers: ['光合成'], tags: ['生物'], wrongChoices: ['呼吸'] },
      [],
      noShuffle,
    );
    expect(built.choices).toHaveLength(2);
  });

  it('列5 誤答が0件なら記述にする', () => {
    const built = buildChoices({ answers: ['光合成'], tags: [], wrongChoices: [] }, [], noShuffle);
    expect(built.choices).toEqual([]);
    expect(built.format).toBe('text');
  });

  it('列8 出題中のキーワード自身は誤答に使わない', () => {
    const built = buildChoices(
      { answers: ['光合成'], tags: ['生物'], wrongChoices: [], keywordId: 'self' },
      [{ keywordId: 'self', answers: ['光合成'], tags: ['生物'], distance: 0, isActive: true }],
      noShuffle,
    );
    expect(built.format).toBe('text');
  });

  it('列10 正答や別解と重なる誤答は除く', () => {
    const built = buildChoices(
      { answers: ['光合成', '炭酸同化'], tags: ['生物'], wrongChoices: ['炭酸同化', '呼吸'] },
      [],
      noShuffle,
    );
    expect([...built.choices].sort()).toEqual(['光合成', '呼吸'].sort());
  });

  it('列11 同じ文字列の誤答は1つにする', () => {
    const built = buildChoices(
      { answers: ['光合成'], tags: ['生物'], wrongChoices: ['呼吸', '呼吸'] },
      [source('呼吸', ['生物'], 0)],
      noShuffle,
    );
    expect([...built.choices].sort()).toEqual(['光合成', '呼吸'].sort());
  });

  it('列14 非活性のキーワードは誤答に使わない', () => {
    const built = buildChoices(
      { answers: ['光合成'], tags: ['生物'], wrongChoices: [] },
      [source('消えた語', ['生物'], 0, false)],
      noShuffle,
    );
    expect(built.format).toBe('text');
  });

  it('列9 候補が多ければ無作為に必要数だけ採る', () => {
    const many = Array.from({ length: 10 }, (_, i) => source(`語${i}`, ['生物'], 0));
    const built = buildChoices({ answers: ['光合成'], tags: ['生物'], wrongChoices: [] }, many, () =>
      Math.random(),
    );
    expect(built.choices).toHaveLength(CHOICE_COUNT);
    expect(new Set(built.choices).size).toBe(CHOICE_COUNT);
  });

  it('列12 並びは毎回同じにならない', () => {
    const build = () =>
      buildChoices(
        { answers: ['光合成'], tags: ['生物'], wrongChoices: ['呼吸', '蒸散', '発酵'] },
        [],
        () => Math.random(),
      ).choices.indexOf('光合成');
    const positions = new Set(Array.from({ length: 40 }, build));
    expect(positions.size).toBeGreaterThan(1);
  });
});
