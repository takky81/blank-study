import { describe, it, expect } from 'vitest';
import { parseMarkdown, type Block } from './markdown';

/** 段落1つ分のインライン要素を取り出す。 */
function inlinesOf(blocks: Block[]) {
  const first = blocks[0];
  if (!first || !('children' in first)) throw new Error('インラインを持たないブロック');
  return first.children;
}

describe('parseMarkdown ブロック（決定表「編集画面の操作」列1）', () => {
  it('見出しの深さを読む', () => {
    expect(parseMarkdown('### 光合成')).toEqual([
      { type: 'heading', level: 3, children: [{ type: 'text', text: '光合成', start: 4 }] },
    ]);
  });

  it('空行で段落を分ける', () => {
    const blocks = parseMarkdown('前の段落\n\n次の段落');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('段落の中の改行は保つ', () => {
    expect(inlinesOf(parseMarkdown('1行目\n2行目'))).toEqual([
      { type: 'text', text: '1行目\n2行目', start: 0 },
    ]);
  });

  it('箇条書きを読む', () => {
    const blocks = parseMarkdown('- 光合成\n- 呼吸');
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          [{ type: 'text', text: '光合成', start: 2 }],
          [{ type: 'text', text: '呼吸', start: 8 }],
        ],
      },
    ]);
  });

  it('番号付きの箇条書きを読む', () => {
    const blocks = parseMarkdown('1. 光合成\n2. 呼吸');
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true });
  });

  it('引用を読む', () => {
    expect(parseMarkdown('> 引用文')).toEqual([
      { type: 'quote', children: [{ type: 'text', text: '引用文', start: 2 }] },
    ]);
  });

  it('コードブロックの中は記法として解釈しない', () => {
    expect(parseMarkdown('```\n{{光合成}}\n**強調**\n```')).toEqual([
      { type: 'code', text: '{{光合成}}\n**強調**' },
    ]);
  });

  it('表を読む（決定表「表示範囲内のキーワードの表示」列16）', () => {
    const blocks = parseMarkdown("| 記号 | 意味 |\n| --- | --- |\n| A | あ |\n| B | い |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'table' });
    const table = blocks[0] as { type: 'table'; head: unknown[]; rows: unknown[][] };
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
  });

  it('表の中のキーワードも空欄になる', () => {
    const blocks = parseMarkdown("| 語 |\n| --- |\n| {{id=a3f9k2}} |");
    const table = blocks[0] as { type: 'table'; rows: { type: string }[][][] };
    expect(table.rows[0]?.[0]?.[0]).toMatchObject({ type: 'blank', docId: 'a3f9k2' });
  });

  it('空の本文はブロックを作らない', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});

describe('parseMarkdown インライン（決定表「編集画面の操作」列1・列14）', () => {
  it('強調と傍点を読む', () => {
    expect(inlinesOf(parseMarkdown('**強い**と*弱い*'))).toEqual([
      { type: 'strong', children: [{ type: 'text', text: '強い', start: 2 }] },
      { type: 'text', text: 'と', start: 6 },
      { type: 'em', children: [{ type: 'text', text: '弱い', start: 8 }] },
    ]);
  });

  it('インラインコードの中は記法として解釈しない', () => {
    expect(inlinesOf(parseMarkdown('`{{光合成}}`'))).toEqual([
      { type: 'code', text: '{{光合成}}' },
    ]);
  });

  it('リンクを読む', () => {
    expect(inlinesOf(parseMarkdown('[説明](https://example.com)'))).toEqual([
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: '説明', start: 1 }] },
    ]);
  });

  it('列14 画像の記述は描画せず文字のまま残す', () => {
    expect(inlinesOf(parseMarkdown('![図](photo.png)'))).toEqual([
      { type: 'text', text: '![図](photo.png)', start: 0 },
    ]);
  });

  it('キーワードの記述を空欄にする', () => {
    expect(inlinesOf(parseMarkdown('植物は {{光合成|id=a3f9k2|tags=生物}} を行う。'))).toEqual([
      { type: 'text', text: '植物は ', start: 0 },
      {
        type: 'blank',
        start: 4,
        end: 29,
        docId: 'a3f9k2',
        answers: ['光合成'],
        tags: ['生物'],
        wrongChoices: [],
      },
      { type: 'text', text: ' を行う。', start: 29 },
    ]);
  });

  it('id のみの記述も空欄にする', () => {
    expect(inlinesOf(parseMarkdown('{{id=a3f9k2}}'))).toMatchObject([
      { type: 'blank', docId: 'a3f9k2', answers: [] },
    ]);
  });

  it('キーワードとして読めない記述は文字のまま残す', () => {
    expect(inlinesOf(parseMarkdown('{{}} と {{光合成'))).toEqual([
      { type: 'text', text: '{{}} と {{光合成', start: 0 },
    ]);
  });

  it('空欄の位置は本文の先頭からの位置になる', () => {
    const blocks = parseMarkdown('# 見出し\n\n{{id=a3f9k2}}');
    const blank = inlinesOf(blocks.slice(1))[0];
    expect(blank).toMatchObject({ type: 'blank', start: 7, end: 20 });
  });
});
