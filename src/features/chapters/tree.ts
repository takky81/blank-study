/**
 * 章の木の操作。決定表「章の管理」 spec/tables/04-chapter.jsonl に対応する。
 * DB を触らない純粋関数にして、並べ替えとネスト変更の規則をここに閉じる。
 */

export type ChapterRow = {
  id: string;
  parentId: string | null;
  title: string;
  sortOrder: number;
};

export type ChapterNode = ChapterRow & {
  depth: number;
  children: ChapterNode[];
};

/** 親子と並び順から木を組み立てる。 */
export function buildTree(rows: readonly ChapterRow[]): ChapterNode[] {
  const byParent = new Map<string | null, ChapterRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(row);
    byParent.set(row.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const build = (parentId: string | null, depth: number): ChapterNode[] =>
    (byParent.get(parentId) ?? []).map((row) => ({
      ...row,
      depth,
      children: build(row.id, depth + 1),
    }));

  return build(null, 0);
}

/** nodeId が ancestorId の子孫か。 */
export function isDescendant(
  rows: readonly ChapterRow[],
  ancestorId: string,
  nodeId: string,
): boolean {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  let current = parentOf.get(nodeId) ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * 移動できるか。
 * 自分自身と自分の子孫の下へは動かせない（列9）。木が循環するため。
 */
export function canMove(
  rows: readonly ChapterRow[],
  movingId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return true;
  if (newParentId === movingId) return false;
  return !isDescendant(rows, movingId, newParentId);
}

/**
 * 章を移す。配下の章は親を変えないのでそのままついていく（列8）。
 * index を省くと移した先の末尾に置く。動かせない指示は並びを変えない。
 */
export function applyMove(
  rows: readonly ChapterRow[],
  movingId: string,
  newParentId: string | null,
  index?: number,
): ChapterRow[] {
  if (!canMove(rows, movingId, newParentId)) return [...rows];

  const moving = rows.find((r) => r.id === movingId);
  if (!moving) return [...rows];

  const siblings = rows
    .filter((r) => r.parentId === newParentId && r.id !== movingId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, { ...moving, parentId: newParentId });

  const renumbered = new Map(siblings.map((r, i) => [r.id, { parentId: newParentId, sortOrder: i }]));

  return rows.map((row) => {
    const update = renumbered.get(row.id);
    return update ? { ...row, ...update } : row;
  });
}

/** 木を1列に並べ直す。画面の描画用。 */
export function flatten(nodes: readonly ChapterNode[]): ChapterNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}
