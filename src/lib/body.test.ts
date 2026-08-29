import { describe, it, expect } from 'vitest';
import {
  formatKeyword,
  formatIdOnly,
  assignDocIds,
  collapseBody,
  expandBody,
  canCreateKeyword,
  canConfirmKeyword,
  applyKeywordToBody,
  removeKeywordFromBody,
} from './body';

/** 採番を固定して結果を確かめるための擬似乱数。 */
function fixedIds(...ids: string[]) {
  let i = 0;
  return () => ids[i++] ?? 'zzzzzz';
}

describe('formatKeyword（決定表「編集画面の操作」列7・列11）', () => {
  it('正答・id・タグ・誤答をこの順に並べる', () => {
    expect(
      formatKeyword({
        answers: ['光合成', '炭酸同化'],
        docId: 'a3f9k2',
        tags: ['生物'],
        wrongChoices: ['呼吸', '蒸散'],
      }),
    ).toBe('{{光合成,炭酸同化|id=a3f9k2|tags=生物|wrong=呼吸,蒸散}}');
  });

  it('空の誤答は書かない（自動生成に任せる）', () => {
    expect(
      formatKeyword({ answers: ['光合成'], docId: 'a3f9k2', tags: [], wrongChoices: [] }),
    ).toBe('{{光合成|id=a3f9k2}}');
  });

  it('区切り文字を含む値はクォートで囲む', () => {
    expect(
      formatKeyword({ answers: ['1,000', 'A|B方式'], docId: null, tags: [], wrongChoices: [] }),
    ).toBe('{{"1,000","A|B方式"}}');
  });

  it('クォートを含む値は連続クォートにする', () => {
    expect(formatKeyword({ answers: ['say "hi"'], docId: null, tags: [], wrongChoices: [] })).toBe(
      '{{"say ""hi"""}}',
    );
  });

  it('id のみの形を作れる', () => {
    expect(formatIdOnly('a3f9k2')).toBe('{{id=a3f9k2}}');
  });
});

describe('assignDocIds（決定表「キーワードIDの採番」）', () => {
  it('列1 id が無ければ採番して本文に書き足す', () => {
    const result = assignDocIds('植物は {{光合成}} を行う。', [], fixedIds('k71m2p'));
    expect(result.body).toBe('植物は {{光合成|id=k71m2p}} を行う。');
    expect(result.keywords).toEqual([
      { docId: 'k71m2p', answers: ['光合成'], tags: [], wrongChoices: [] },
    ]);
  });

  it('列2 記述された id をそのまま使う', () => {
    const result = assignDocIds('{{光合成|id=a3f9k2}}', [], fixedIds('k71m2p'));
    expect(result.body).toBe('{{光合成|id=a3f9k2}}');
    expect(result.keywords[0]?.docId).toBe('a3f9k2');
  });

  it('列3 教材内に同じ id があっても採番し直さない', () => {
    const result = assignDocIds('{{光合成|id=a3f9k2}}', ['a3f9k2'], fixedIds('k71m2p'));
    expect(result.keywords[0]?.docId).toBe('a3f9k2');
  });

  it('列4 採番した id が既存とぶつかったら引き直す', () => {
    const result = assignDocIds('{{光合成}}', ['k71m2p'], fixedIds('k71m2p', 'w4d8x1'));
    expect(result.keywords[0]?.docId).toBe('w4d8x1');
  });

  it('列4 同じ本文の中でも採番した id は重ならない', () => {
    const result = assignDocIds(
      '{{光合成}} と {{呼吸}}',
      [],
      fixedIds('k71m2p', 'k71m2p', 'w4d8x1'),
    );
    expect(result.keywords.map((k) => k.docId)).toEqual(['k71m2p', 'w4d8x1']);
  });

  it('列5 別の教材の id は既存として渡らないのでそのまま使える', () => {
    const result = assignDocIds('{{光合成|id=a3f9k2}}', ['zzzzzz'], fixedIds('k71m2p'));
    expect(result.keywords[0]?.docId).toBe('a3f9k2');
  });

  it('列6 規約外の id は採番し直して本文を書き換える', () => {
    const result = assignDocIds('{{光合成|id=abc}}', [], fixedIds('k71m2p'));
    expect(result.body).toBe('{{光合成|id=k71m2p}}');
    expect(result.keywords[0]?.docId).toBe('k71m2p');
  });

  it('列7 大文字を含む id は受け付けず採番し直す', () => {
    const result = assignDocIds('{{光合成|id=A3F9K2}}', [], fixedIds('k71m2p'));
    expect(result.keywords[0]?.docId).toBe('k71m2p');
  });

  it('id のみの記述は定義として扱わない', () => {
    const result = assignDocIds('{{id=a3f9k2}}', ['a3f9k2'], fixedIds('k71m2p'));
    expect(result.body).toBe('{{id=a3f9k2}}');
    expect(result.keywords).toEqual([]);
  });

  it('キーワードとして認識しない記述はそのまま残す', () => {
    const result = assignDocIds('{{}} と {{光合成', [], fixedIds('k71m2p'));
    expect(result.body).toBe('{{}} と {{光合成');
    expect(result.keywords).toEqual([]);
  });
});

describe('collapseBody（決定表「保存と正規化」列1・列2）', () => {
  it('列1 フル形式を id のみに縮約する', () => {
    expect(collapseBody('植物は {{光合成|id=a3f9k2|tags=生物}} を行う。')).toBe(
      '植物は {{id=a3f9k2}} を行う。',
    );
  });

  it('列2 同じ id が複数回出てもすべて id のみにする', () => {
    expect(collapseBody('{{光合成|id=a3f9k2}} と {{id=a3f9k2}}')).toBe(
      '{{id=a3f9k2}} と {{id=a3f9k2}}',
    );
  });

  it('id を持たない記述は触らない', () => {
    expect(collapseBody('{{光合成}}')).toBe('{{光合成}}');
  });
});

describe('expandBody（決定表「保存と正規化」列6）', () => {
  const byId = new Map([
    ['a3f9k2', { answers: ['光合成', '炭酸同化'], tags: ['生物'], wrongChoices: ['呼吸'] }],
  ]);

  it('列6 章の中で最初の1か所だけフル形式にする', () => {
    expect(expandBody('{{id=a3f9k2}} と {{id=a3f9k2}}', byId)).toBe(
      '{{光合成,炭酸同化|id=a3f9k2|tags=生物|wrong=呼吸}} と {{id=a3f9k2}}',
    );
  });

  it('登録が無い id は id のまま残す', () => {
    expect(expandBody('{{id=zzzzzz}}', byId)).toBe('{{id=zzzzzz}}');
  });

  it('縮約と展開で元の記述に戻る', () => {
    const expanded = '{{光合成,炭酸同化|id=a3f9k2|tags=生物|wrong=呼吸}} と {{id=a3f9k2}}';
    expect(expandBody(collapseBody(expanded), byId)).toBe(expanded);
  });
});

describe('canCreateKeyword（決定表「編集画面の操作」列4・列5）', () => {
  const body = '植物は {{光合成|id=a3f9k2}} を行う。';

  it('選択範囲があれば作れる', () => {
    expect(canCreateKeyword(body, 0, 2)).toBe(true);
  });

  it('列4 選択が無ければ作れない', () => {
    expect(canCreateKeyword(body, 3, 3)).toBe(false);
  });

  it('列5 既存のキーワードにかかる選択では作れない', () => {
    expect(canCreateKeyword(body, 0, 6)).toBe(false);
    expect(canCreateKeyword(body, 5, 8)).toBe(false);
  });
});

describe('キーワード編集ダイアログの反映（決定表「編集画面の操作」列7・列8・列10）', () => {
  it('列8 正答が0件なら確定できない', () => {
    expect(canConfirmKeyword({ answers: [], docId: null, tags: [], wrongChoices: [] })).toBe(false);
    expect(
      canConfirmKeyword({ answers: ['光合成'], docId: null, tags: [], wrongChoices: [] }),
    ).toBe(true);
  });

  it('列7 選択範囲を記述に置き換える', () => {
    expect(
      applyKeywordToBody('植物は光合成を行う。', 3, 6, {
        answers: ['光合成'],
        docId: null,
        tags: ['生物'],
        wrongChoices: [],
      }),
    ).toBe('植物は{{光合成|tags=生物}}を行う。');
  });

  it('列7 既存の記述をまるごと置き換える', () => {
    const body = '植物は {{光合成|id=a3f9k2}} を行う。';
    expect(
      applyKeywordToBody(body, 4, 21, {
        answers: ['光合成', '炭酸同化'],
        docId: 'a3f9k2',
        tags: [],
        wrongChoices: [],
      }),
    ).toBe('植物は {{光合成,炭酸同化|id=a3f9k2}} を行う。');
  });

  it('列10 解除すると正答の先頭が素のテキストになる', () => {
    expect(removeKeywordFromBody('植物は {{光合成,炭酸同化|id=a3f9k2}} を行う。', 4)).toBe(
      '植物は 光合成 を行う。',
    );
  });

  it('列10 id のみの記述は渡された正答を素のテキストにする', () => {
    expect(removeKeywordFromBody('植物は {{id=a3f9k2}} を行う。', 4, ['光合成'])).toBe(
      '植物は 光合成 を行う。',
    );
  });

  it('列10 正答が分からなければ記述だけを外す', () => {
    expect(removeKeywordFromBody('植物は {{id=a3f9k2}} を行う。', 4)).toBe('植物は  を行う。');
  });
});
