/**
 * 科目・教材・章に共通する名前の検査。
 * 決定表「科目の管理」列2・列3・列4、「教材の管理」列2・列3、「章の管理」列3 に対応する。
 */

/** 前後の空白を落として保存する。 */
export function normalizeName(value: string): string {
  return value.trim();
}

/**
 * 名前として受け付けるか。
 * 空と空白だけを弾く。既存と同じ名前は許す（重複を許容する）。
 */
export function isValidName(value: string): boolean {
  return normalizeName(value) !== '';
}

/**
 * 並べ替えのあとの sort_order を振り直す。
 * from の位置にある要素を to の位置へ動かした並びを返す。
 */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(to, 0, moved);
  return next;
}
