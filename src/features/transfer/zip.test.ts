import { describe, it, expect } from 'vitest';
import { buildFiles, parseFiles, safeFileName, type ExportChapter } from './zip';

/** 章を組み立てる。並び順は配列の順に合わせる。 */
function chapter(
  id: string,
  parentId: string | null,
  title: string,
  sortOrder: number,
  body = '',
): ExportChapter {
  return { id, parentId, title, sortOrder, body };
}

describe('safeFileName（決定表「エクスポート」列8）', () => {
  it('ファイル名に使えない文字を置き換える', () => {
    expect(safeFileName('入出力/装置')).toBe('入出力_装置');
    expect(safeFileName('A:B*C?D"E<F>G|H\\I')).toBe('A_B_C_D_E_F_G_H_I');
  });

  it('前後の空白と末尾のドットを落とす', () => {
    expect(safeFileName('  章名. ')).toBe('章名');
  });

  it('空になったら連番で埋める側に任せる', () => {
    expect(safeFileName('   ')).toBe('');
  });
});

describe('buildFiles（決定表「エクスポート」）', () => {
  const keywords = new Map([
    ['a3f9k2', { answers: ['光合成'], tags: ['生物'], wrongChoices: ['呼吸'] }],
  ]);

  it('列1・列2 章の階層をフォルダにし、連番で並び順を表す', () => {
    const files = buildFiles(
      [
        chapter('1', null, '基礎理論', 0, '# 基礎理論'),
        chapter('2', '1', '2進数', 0, '2進数の本文'),
        chapter('3', '1', '論理演算', 1, '論理演算の本文'),
        chapter('4', null, 'アルゴリズム', 1, ''),
      ],
      keywords,
    );

    expect(Object.keys(files).sort()).toEqual(
      [
        '010_基礎理論/index.md',
        '010_基礎理論/010_2進数.md',
        '010_基礎理論/020_論理演算.md',
        '020_アルゴリズム.md',
      ].sort(),
    );
    expect(files['010_基礎理論/index.md']).toBe('# 基礎理論');
  });

  it('列1 本文は章の最初の1か所だけフル形式にする', () => {
    const files = buildFiles(
      [chapter('1', null, '光合成', 0, '{{id=a3f9k2}} と {{id=a3f9k2}}')],
      keywords,
    );
    expect(files['010_光合成.md']).toBe(
      '{{光合成|id=a3f9k2|tags=生物|wrong=呼吸}} と {{id=a3f9k2}}',
    );
  });

  it('列3 メタ情報や履歴のファイルを作らない', () => {
    const files = buildFiles([chapter('1', null, '光合成', 0, '本文')], keywords);
    expect(Object.keys(files)).toEqual(['010_光合成.md']);
  });

  it('列4 本文に出てこないキーワードは書き出さない', () => {
    const files = buildFiles([chapter('1', null, '光合成', 0, '本文だけ')], keywords);
    expect(files['010_光合成.md']).toBe('本文だけ');
  });

  it('列6 キーワードが1件も無くても本文を書き出す', () => {
    const files = buildFiles([chapter('1', null, '光合成', 0, '本文')], new Map());
    expect(files['010_光合成.md']).toBe('本文');
  });

  it('列7 章が1件も無ければ書き出さない', () => {
    expect(() => buildFiles([], keywords)).toThrow(/章/);
  });

  it('列8 ファイル名は安全な文字にし、本文の側の章タイトルは変えない', () => {
    const files = buildFiles([chapter('1', null, '入出力/装置', 0, '# 入出力/装置')], keywords);
    expect(Object.keys(files)).toEqual(['010_入出力_装置.md']);
    expect(files['010_入出力_装置.md']).toBe('# 入出力/装置');
  });

  it('列9 同じ親に同じタイトルがあれば連番で区別する', () => {
    const files = buildFiles(
      [chapter('1', null, '補足', 0, 'ひとつめ'), chapter('2', null, '補足', 1, 'ふたつめ')],
      keywords,
    );
    expect(Object.keys(files).sort()).toEqual(['010_補足.md', '020_補足.md']);
  });
});

describe('parseFiles（決定表「インポートの単位」）', () => {
  it('列3 連番プレフィックスを並び順にし、タイトルからは外す', () => {
    const nodes = parseFiles({
      '020_アルゴリズム.md': 'あとの章',
      '010_基礎理論.md': 'さきの章',
    });
    expect(nodes.map((n) => [n.title, n.sortOrder, n.body])).toEqual([
      ['基礎理論', 0, 'さきの章'],
      ['アルゴリズム', 1, 'あとの章'],
    ]);
  });

  it('列4 フォルダの index.md をその章自体の本文にする', () => {
    const nodes = parseFiles({
      '010_基礎理論/index.md': '基礎理論の本文',
      '010_基礎理論/010_2進数.md': '2進数の本文',
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.title).toBe('基礎理論');
    expect(nodes[0]?.body).toBe('基礎理論の本文');
    expect(nodes[0]?.children.map((c) => c.title)).toEqual(['2進数']);
  });

  it('列6 .md が1つも無ければ弾く', () => {
    expect(() => parseFiles({ 'readme.txt': 'text' })).toThrow(/章/);
  });

  it('列8 連番が無ければ名前順に並べる', () => {
    const nodes = parseFiles({ 'B章.md': 'b', 'A章.md': 'a' });
    expect(nodes.map((n) => n.title)).toEqual(['A章', 'B章']);
  });

  it('列9 index.md が無いフォルダも章として作り、本文は空にする', () => {
    const nodes = parseFiles({ '010_基礎理論/010_2進数.md': '2進数の本文' });
    expect(nodes[0]?.title).toBe('基礎理論');
    expect(nodes[0]?.body).toBe('');
    expect(nodes[0]?.children[0]?.body).toBe('2進数の本文');
  });

  it('入れ子のフォルダも階層として読む', () => {
    const nodes = parseFiles({ 'A/B/C.md': '深い本文' });
    expect(nodes[0]?.children[0]?.children[0]?.title).toBe('C');
  });
});

describe('書き出して読み直す', () => {
  it('章の構成とタイトルが元に戻る', () => {
    const files = buildFiles(
      [
        chapter('1', null, '基礎理論', 0, '# 基礎理論'),
        chapter('2', '1', '2進数', 0, '2進数の本文'),
        chapter('3', null, 'アルゴリズム', 1, ''),
      ],
      new Map(),
    );
    const nodes = parseFiles(files);
    expect(nodes.map((n) => n.title)).toEqual(['基礎理論', 'アルゴリズム']);
    expect(nodes[0]?.children.map((c) => c.title)).toEqual(['2進数']);
    expect(nodes[0]?.body).toBe('# 基礎理論');
  });
});
