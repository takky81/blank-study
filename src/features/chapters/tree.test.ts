import { describe, it, expect } from 'vitest';
import { buildTree, isDescendant, canMove, applyMove, type ChapterRow } from './tree';

/**
 * 章の木。
 *   基礎理論
 *     2進数
 *     論理演算
 *   アルゴリズム
 */
const rows: ChapterRow[] = [
  { id: 'a', parentId: null, title: '基礎理論', sortOrder: 0 },
  { id: 'a1', parentId: 'a', title: '2進数', sortOrder: 0 },
  { id: 'a2', parentId: 'a', title: '論理演算', sortOrder: 1 },
  { id: 'b', parentId: null, title: 'アルゴリズム', sortOrder: 1 },
];

// 決定表「章の管理」 spec/tables/04-chapter.jsonl
describe('章の木', () => {
  it('親子と並び順から木を組み立てる', () => {
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.children[0]?.depth).toBe(1);
  });

  it('列9 moveChapter: 子孫かどうかを見分ける', () => {
    expect(isDescendant(rows, 'a', 'a1')).toBe(true);
    expect(isDescendant(rows, 'a', 'b')).toBe(false);
    expect(isDescendant(rows, 'a1', 'a')).toBe(false);
  });

  it('列9 moveChapter: 自分自身と子孫の下へは動かせない', () => {
    expect(canMove(rows, 'a', 'a')).toBe(false);
    expect(canMove(rows, 'a', 'a1')).toBe(false);
    expect(canMove(rows, 'a', 'b')).toBe(true);
    expect(canMove(rows, 'a1', null)).toBe(true);
  });

  it('列8 moveChapter: ネストを変える。配下もついていく', () => {
    const next = applyMove(rows, 'a', 'b');
    expect(next.find((r) => r.id === 'a')?.parentId).toBe('b');
    // 子は親を変えずについていく
    expect(next.find((r) => r.id === 'a1')?.parentId).toBe('a');
    const tree = buildTree(next);
    expect(tree.map((n) => n.id)).toEqual(['b']);
    expect(tree[0]?.children[0]?.children.map((n) => n.id)).toEqual(['a1', 'a2']);
  });

  it('列8 moveChapter: 移した先の末尾に置き、並び順を振り直す', () => {
    const next = applyMove(rows, 'a1', null);
    const top = next.filter((r) => r.parentId === null).sort((x, y) => x.sortOrder - y.sortOrder);
    expect(top.map((r) => r.id)).toEqual(['a', 'b', 'a1']);
    expect(top.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it('列9 applyMove: 動かせない指示は並びを変えない', () => {
    expect(applyMove(rows, 'a', 'a1')).toEqual(rows);
  });

  it('列7 applyMove: 同じ親の中で並べ替える', () => {
    const next = applyMove(rows, 'a2', 'a', 0);
    const children = next
      .filter((r) => r.parentId === 'a')
      .sort((x, y) => x.sortOrder - y.sortOrder);
    expect(children.map((r) => r.id)).toEqual(['a2', 'a1']);
    expect(children.map((r) => r.sortOrder)).toEqual([0, 1]);
  });
});
