/**
 * 保存時の上書き確認。決定表「保存時の上書き確認」に対応する。
 * 突合の規則はインポートと同じものを使う。違うのは、
 * キーワード編集ダイアログで変えたものは確認しない点だけ（列1）。
 */

import type { KeywordDefinition, KeywordFields } from '@/lib/body';
import { matchKeywords, type Conflict, type Plan } from '@/features/transfer/match';

export type SavePlan = {
  apply: Plan[];
  conflicts: Conflict[];
};

/**
 * 保存する内容を、そのまま書けるものと確認が要るものに分ける。
 * trusted はダイアログ経由で変えたキーワードのID。
 */
export function planSave(
  keywords: readonly KeywordDefinition[],
  existing: ReadonlyMap<string, KeywordFields>,
  trusted: ReadonlySet<string>,
): SavePlan {
  const { apply, conflicts } = matchKeywords(
    keywords.map((k) => ({
      docId: k.docId,
      answers: k.answers,
      tags: k.tags,
      wrongChoices: k.wrongChoices,
    })),
    existing,
  );

  // ダイアログで変えたものは、書き手が中身を見て決めているので確認しない（列1）
  const trustedConflicts = conflicts.filter((c) => trusted.has(c.docId));
  return {
    apply: [
      ...apply,
      ...trustedConflicts.map((c) => ({ kind: 'overwrite' as const, docId: c.docId, fields: c.incoming })),
    ],
    // 確認するのは一致しなかったものだけ（列8）
    conflicts: conflicts.filter((c) => !trusted.has(c.docId)),
  };
}
