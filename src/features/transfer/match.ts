/**
 * インポート時のキーワード突合。
 * 決定表「インポート時のキーワード突合」列1-列5・列10 に対応する。
 */

import { normalizeAnswer } from '@/lib/answer';
import type { KeywordFields } from '@/lib/body';

export type ImportedKeyword = KeywordFields & { docId: string | null };

export type Plan =
  /** 採番して新しく登録する */
  | { kind: 'new'; docId: string | null; fields: KeywordFields }
  /** 既存のキーワードを取り込んだ内容で置き換える。解答履歴と SRS は続く */
  | { kind: 'overwrite'; docId: string; fields: KeywordFields };

export type Conflict = {
  docId: string;
  /** answers: DB の正答と重ならない / duplicate: zip の中で内容が食い違う */
  reason: 'answers' | 'duplicate';
  current: KeywordFields | null;
  incoming: KeywordFields;
  /** zip の中で食い違ったとき、もう一方の内容 */
  other?: KeywordFields;
};

function sameFields(a: KeywordFields, b: KeywordFields): boolean {
  const same = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return same(a.answers, b.answers) && same(a.tags, b.tags) && same(a.wrongChoices, b.wrongChoices);
}

/** 正答が1つでも重なるか。表記ゆれは解答判定と同じ規則で吸収する。 */
function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a.map(normalizeAnswer));
  return b.some((value) => set.has(normalizeAnswer(value)));
}

/**
 * 取り込むキーワードを、そのまま適用できるものと確認が要るものに分ける。
 * 確認が要るものは、確認が済むまで適用しない。
 */
export function matchKeywords(
  incoming: readonly ImportedKeyword[],
  existing: ReadonlyMap<string, KeywordFields>,
): { apply: Plan[]; conflicts: Conflict[] } {
  const apply: Plan[] = [];
  const conflicts: Conflict[] = [];

  // zip の中で同じ id が複数あるとき、内容が食い違えば確認する（列5）
  const byDocId = new Map<string, ImportedKeyword[]>();
  const withoutId: ImportedKeyword[] = [];
  for (const keyword of incoming) {
    if (keyword.docId === null) {
      withoutId.push(keyword);
      continue;
    }
    const found = byDocId.get(keyword.docId) ?? [];
    found.push(keyword);
    byDocId.set(keyword.docId, found);
  }

  // 列1: id が無ければ新規
  for (const keyword of withoutId) {
    apply.push({ kind: 'new', docId: null, fields: fieldsOf(keyword) });
  }

  for (const [docId, group] of byDocId) {
    const first = group[0] as ImportedKeyword;
    const differing = group.find((k) => !sameFields(fieldsOf(k), fieldsOf(first)));
    if (differing) {
      conflicts.push({
        docId,
        reason: 'duplicate',
        current: existing.get(docId) ?? null,
        incoming: fieldsOf(first),
        other: fieldsOf(differing),
      });
      continue;
    }

    const current = existing.get(docId);
    // 列2: 取り込み先に無い id は新規
    if (!current) {
      apply.push({ kind: 'new', docId, fields: fieldsOf(first) });
      continue;
    }

    // 列3: 正答が1つ以上重なれば確認なしで上書き
    if (overlaps(current.answers, first.answers)) {
      apply.push({ kind: 'overwrite', docId, fields: fieldsOf(first) });
      continue;
    }

    // 列4: 重ならなければ確認する
    conflicts.push({ docId, reason: 'answers', current, incoming: fieldsOf(first) });
  }

  return { apply, conflicts };
}

function fieldsOf(keyword: ImportedKeyword): KeywordFields {
  return {
    answers: keyword.answers,
    tags: keyword.tags,
    wrongChoices: keyword.wrongChoices,
  };
}
