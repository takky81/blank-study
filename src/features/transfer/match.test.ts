import { describe, it, expect } from 'vitest';
import { matchKeywords, type ImportedKeyword } from './match';

const existing = new Map([
  ['a3f9k2', { answers: ['光合成', '炭酸同化'], tags: ['生物'], wrongChoices: ['呼吸'] }],
]);

function imported(docId: string | null, answers: string[]): ImportedKeyword {
  return { docId, answers, tags: [], wrongChoices: [] };
}

describe('matchKeywords（決定表「インポート時のキーワード突合」）', () => {
  it('列1 id が無ければ新規として扱う', () => {
    const result = matchKeywords([imported(null, ['呼吸'])], existing);
    expect(result.conflicts).toEqual([]);
    expect(result.apply.map((k) => k.kind)).toEqual(['new']);
  });

  it('列2 取り込み先に無い id は新規として扱う', () => {
    const result = matchKeywords([imported('zzzzzz', ['呼吸'])], existing);
    expect(result.conflicts).toEqual([]);
    expect(result.apply.map((k) => k.kind)).toEqual(['new']);
  });

  it('列3 正答が1つでも重なれば確認なしで上書きする', () => {
    const result = matchKeywords([imported('a3f9k2', ['光合成', '同化作用'])], existing);
    expect(result.conflicts).toEqual([]);
    expect(result.apply[0]).toMatchObject({ kind: 'overwrite', docId: 'a3f9k2' });
  });

  it('列3 正答の照合は表記ゆれを吸収する', () => {
    const result = matchKeywords([imported('a3f9k2', ['光合成 '])], existing);
    expect(result.conflicts).toEqual([]);
  });

  it('列4 正答がひとつも重ならなければ確認する', () => {
    const result = matchKeywords([imported('a3f9k2', ['呼吸'])], existing);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      docId: 'a3f9k2',
      reason: 'answers',
      current: { answers: ['光合成', '炭酸同化'] },
      incoming: { answers: ['呼吸'] },
    });
    // 確認するものは、確認が済むまで適用しない
    expect(result.apply).toEqual([]);
  });

  it('列5 zip の中で同じ id の内容が食い違えば確認する', () => {
    const result = matchKeywords(
      [imported('w4d8x1', ['光合成']), imported('w4d8x1', ['呼吸'])],
      existing,
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ docId: 'w4d8x1', reason: 'duplicate' });
  });

  it('列5 zip の中で同じ id でも内容が同じなら確認しない', () => {
    const result = matchKeywords(
      [imported('w4d8x1', ['光合成']), imported('w4d8x1', ['光合成'])],
      existing,
    );
    expect(result.conflicts).toEqual([]);
    expect(result.apply).toHaveLength(1);
  });

  it('列10 食い違いが無ければ確認は0件になる', () => {
    const result = matchKeywords([imported('a3f9k2', ['光合成'])], existing);
    expect(result.conflicts).toHaveLength(0);
  });
});
