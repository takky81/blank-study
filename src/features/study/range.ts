/**
 * 表示範囲の中で、キーワードをどう見せるか。
 * 決定表「表示範囲内のキーワードの表示」に対応する。
 */

import { normalizeAnswer } from '@/lib/answer';
import { sameTag } from './question';

export type BlankColor = 'yellow' | 'gray' | 'orange' | 'none';

export type BlankView = {
  /** input なら入力欄・選択欄、text なら文字を出す */
  display: 'input' | 'text';
  text: string;
  color: BlankColor;
};

export type ViewContext = {
  phase: 'answering' | 'judged';
  currentDocId: string;
  keywords: ReadonlyMap<string, { answers: string[]; tags: string[] }>;
  /** 判定後のみ */
  correct?: boolean;
  input?: string;
};

/** 伏せ字に使うタグ。出題中のキーワードのタグの並び順で先に来るものを使う（列13）。 */
function maskTag(currentTags: readonly string[], otherTags: readonly string[]): string | null {
  const other = new Set(otherTags);
  return currentTags.find((tag) => other.has(tag)) ?? null;
}

/**
 * 1つの空欄の見せ方を決める。
 * 同じ id が複数箇所に出ても同じ結果になるので、まとめて空欄にできる（列11）。
 */
export function viewOfBlank(docId: string, context: ViewContext): BlankView {
  const keyword = context.keywords.get(docId);
  if (!keyword) return { display: 'text', text: '', color: 'none' };

  const current = context.keywords.get(context.currentDocId);
  const answer = keyword.answers[0] ?? '';

  // 出題中のキーワード（列1・列4）
  if (docId === context.currentDocId) {
    if (context.phase === 'answering') return { display: 'input', text: '', color: 'yellow' };
    return { display: 'text', text: answer, color: 'yellow' };
  }

  const masked = current ? sameTag(current.tags, keyword.tags) : false;

  // 解答中は同じタグのものだけ伏せる（列2・列3・列12）
  if (context.phase === 'answering') {
    if (!masked) return { display: 'text', text: answer, color: 'none' };
    const tag = maskTag(current?.tags ?? [], keyword.tags);
    return { display: 'text', text: `〈${tag}〉`, color: 'gray' };
  }

  // 判定後は伏せ字を戻す。不正解のとき、答えた語が入る位置を橙で示す（列5・列6・列7・列15）
  const matched =
    context.correct === false &&
    context.input !== undefined &&
    keyword.answers.some(
      (value) => normalizeAnswer(value) === normalizeAnswer(context.input ?? ''),
    );
  if (matched) return { display: 'text', text: answer, color: 'orange' };

  return { display: 'text', text: answer, color: masked ? 'gray' : 'none' };
}

/** 既定の表示範囲は出題中のキーワードを含む章（列8）。 */
export function defaultRange(): number {
  return 0;
}

/** 1段上へ広げる。教材全体で打ち止め（列9・列10）。 */
export function expandRange(level: number, maxLevel: number): number {
  return Math.min(level + 1, maxLevel);
}

export function canExpandRange(level: number, maxLevel: number): boolean {
  return level < maxLevel;
}
