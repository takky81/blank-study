import { describe, it, expect } from 'vitest';
import { parseKeywordToken, scanKeywordTokens, isValidDocId } from './keyword';

const parse = (inner: string) => parseKeywordToken(inner);

// 決定表「キーワード記法のパース」 spec/tables/06-keyword-syntax.jsonl
describe('キーワード記法のパース', () => {
  it('列1 parseKeyword: 正答リストのみ', () => {
    expect(parse('ビット')).toEqual({
      answers: ['ビット'],
      docId: null,
      tags: [],
      wrongChoices: [],
    });
  });

  it('列2 parseKeyword: 全項目を指定', () => {
    expect(parse('光合成,炭酸同化|id=a3f9k2|tags=生物,用語|wrong=呼吸,蒸散')).toEqual({
      answers: ['光合成', '炭酸同化'],
      docId: 'a3f9k2',
      tags: ['生物', '用語'],
      wrongChoices: ['呼吸', '蒸散'],
    });
  });

  it('列3 parseKeyword: id のみの参照', () => {
    expect(parse('id=a3f9k2')).toEqual({
      answers: [],
      docId: 'a3f9k2',
      tags: [],
      wrongChoices: [],
    });
  });

  it('列4 parseKeyword: セグメントの順序に依存しない', () => {
    expect(parse('光合成|wrong=呼吸|tags=生物|id=a3f9k2')).toEqual(
      parse('光合成|id=a3f9k2|tags=生物|wrong=呼吸'),
    );
  });

  it('列5 parseKeyword: カンマを含む正答をクォートで囲む', () => {
    expect(parse('"1,000",千|tags=数値')?.answers).toEqual(['1,000', '千']);
  });

  it('列5 parseKeyword: パイプを含む正答をクォートで囲む', () => {
    expect(parse('"A|B方式"|tags=用語')?.answers).toEqual(['A|B方式']);
  });

  it('列6 parseKeyword: クォートなしの区切り文字', () => {
    expect(parse('1,000')?.answers).toEqual(['1', '000']);
  });

  it('列7 parseKeyword: クォートのエスケープ', () => {
    expect(parse('"say ""hi"""')?.answers).toEqual(['say "hi"']);
  });

  it('列8 parseKeyword: 空の記述を無視する', () => {
    expect(parse('')).toBeNull();
  });

  it('列10 parseKeyword: 未知のキーを読み飛ばす', () => {
    expect(parse('光合成|foo=bar|tags=生物')).toEqual({
      answers: ['光合成'],
      docId: null,
      tags: ['生物'],
      wrongChoices: [],
    });
  });

  it('列11 parseKeyword: 重複したキーは後勝ち', () => {
    expect(parse('光合成|tags=生物|tags=化学')?.tags).toEqual(['化学']);
  });

  it('列12 parseKeyword: 値の前後の空白を落とす', () => {
    expect(parse(' 光合成 , 炭酸同化 |tags= 生物 ')).toMatchObject({
      answers: ['光合成', '炭酸同化'],
      tags: ['生物'],
    });
  });

  it('列13 parseKeyword: 空の tags を空配列にする', () => {
    expect(parse('光合成|tags=')?.tags).toEqual([]);
  });

  it('列14 parseKeyword: 正答1件', () => {
    expect(parse('光合成')?.answers).toEqual(['光合成']);
  });

  it('列15 parseKeyword: 正答の重複を落とす', () => {
    expect(parse('光合成,光合成')?.answers).toEqual(['光合成']);
  });

  it('列16 parseKeyword: 記述は1行に収める', () => {
    expect(parse('光合成\n|tags=生物')).toBeNull();
  });
});

// 決定表「キーワード記法のパース」列9 と、本文からの切り出し
describe('本文からの切り出し', () => {
  it('列9 parseKeyword: 閉じていない記述を無視する', () => {
    expect(scanKeywordTokens('植物は {{光合成 を行う。')).toEqual([]);
    expect(scanKeywordTokens('植物は {{光合成\n}} を行う。')).toEqual([]);
  });

  it('本文中の複数の記述を順に取り出す', () => {
    const body = '1桁を {{ビット|id=k71m2p}} と呼び、8桁を {{id=q4x8dz}} という。';
    const tokens = scanKeywordTokens(body);
    expect(tokens.map((t) => t.inner)).toEqual(['ビット|id=k71m2p', 'id=q4x8dz']);
    expect(body.slice(tokens[0]!.start, tokens[0]!.end)).toBe('{{ビット|id=k71m2p}}');
  });

  it('クォートの中の閉じ括弧を区切りにしない', () => {
    const tokens = scanKeywordTokens('答えは {{"a}}b"|tags=記号}} です。');
    expect(tokens).toHaveLength(1);
    expect(parse(tokens[0]!.inner)?.answers).toEqual(['a}}b']);
  });
});

// 決定表「キーワードIDの採番」 spec/tables/07-keyword-id.jsonl
describe('キーワードIDの採番', () => {
  it('列6 assignId: 規約外の id は採番し直す', () => {
    expect(isValidDocId('abc12')).toBe(false);
    expect(isValidDocId('abc1234')).toBe(false);
  });

  it('列7 assignId: 大文字を含む id を受け付けない', () => {
    expect(isValidDocId('ABC123')).toBe(false);
    expect(isValidDocId('a3f9k2')).toBe(true);
  });
});
