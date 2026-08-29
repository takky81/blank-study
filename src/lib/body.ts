/**
 * 本文とキーワード記述の相互変換。
 * 決定表「編集画面の操作」「キーワードIDの採番」「保存と正規化」に対応する。
 * 書式と保存形式・展開形式の定義は docs/仕様書.md §4 を参照。
 */

import {
  scanKeywordTokens,
  parseKeywordToken,
  isValidDocId,
  type KeywordToken,
  type ParsedKeyword,
} from './keyword';

/** 記述に書き出せる形のキーワード。 */
export type KeywordFields = {
  answers: string[];
  tags: string[];
  wrongChoices: string[];
};

export type KeywordDefinition = KeywordFields & { docId: string };

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 区切り文字とクォートを含む値を安全な形にする（仕様書 §4.2）。 */
function quoteValue(value: string): string {
  if (!/[,|"]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function joinList(values: readonly string[]): string {
  return values.map(quoteValue).join(',');
}

/** フル形式の記述を作る。空のタグと誤答は書かない。 */
export function formatKeyword(keyword: ParsedKeyword): string {
  const segments = [joinList(keyword.answers)];
  if (keyword.docId !== null) segments.push(`id=${keyword.docId}`);
  if (keyword.tags.length > 0) segments.push(`tags=${joinList(keyword.tags)}`);
  if (keyword.wrongChoices.length > 0) segments.push(`wrong=${joinList(keyword.wrongChoices)}`);
  return `{{${segments.join('|')}}}`;
}

/** 保存形式の記述を作る。 */
export function formatIdOnly(docId: string): string {
  return `{{id=${docId}}}`;
}

/** 小文字英数字6桁のIDを引く（仕様書 §5.2）。 */
export function randomDocId(): string {
  let id = '';
  for (let i = 0; i < 6; i += 1) {
    id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return id;
}

/** 本文の記述を1つずつ置き換える。後ろから当てて位置がずれないようにする。 */
function rewriteTokens(
  body: string,
  replace: (token: KeywordToken, keyword: ParsedKeyword) => string | null,
): string {
  const tokens = scanKeywordTokens(body);
  let result = body;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (!token) continue;
    const parsed = parseKeywordToken(token.inner);
    if (!parsed) continue;
    const next = replace(token, parsed);
    if (next === null) continue;
    result = result.slice(0, token.start) + next + result.slice(token.end);
  }
  return result;
}

/**
 * 記述にIDを行き渡らせる（決定表「キーワードIDの採番」）。
 * 記述されたIDが規約外なら引き直し、本文にも書き戻す。
 * 返す keywords は正答を持つ記述だけ。IDのみの記述は既存への参照なので含めない。
 */
export function assignDocIds(
  body: string,
  existingIds: Iterable<string>,
  nextId: () => string = randomDocId,
): { body: string; keywords: KeywordDefinition[] } {
  const taken = new Set(existingIds);
  const tokens = scanKeywordTokens(body);

  // 記述されたIDは先に押さえてから採番する。採番が既存とぶつからないようにする
  for (const token of tokens) {
    const parsed = parseKeywordToken(token.inner);
    if (parsed?.docId !== null && parsed?.docId !== undefined && isValidDocId(parsed.docId)) {
      taken.add(parsed.docId);
    }
  }

  const draw = () => {
    let id = nextId();
    while (taken.has(id)) id = nextId();
    taken.add(id);
    return id;
  };

  const keywords: KeywordDefinition[] = [];
  // 本文の前から順に採番する。後ろから当てると採番の順が本文と入れ替わる
  const planned = new Map<number, string>();
  for (const token of tokens) {
    const parsed = parseKeywordToken(token.inner);
    if (!parsed) continue;
    const keep = parsed.docId !== null && isValidDocId(parsed.docId);
    if (keep && parsed.docId !== null) {
      if (parsed.answers.length > 0) {
        keywords.push({
          docId: parsed.docId,
          answers: parsed.answers,
          tags: parsed.tags,
          wrongChoices: parsed.wrongChoices,
        });
      }
      continue;
    }
    const docId = draw();
    planned.set(token.start, docId);
    if (parsed.answers.length > 0) {
      keywords.push({
        docId,
        answers: parsed.answers,
        tags: parsed.tags,
        wrongChoices: parsed.wrongChoices,
      });
    }
  }

  const nextBody = rewriteTokens(body, (token, parsed) => {
    const drawn = planned.get(token.start);
    if (drawn === undefined) return null;
    // IDのみの記述は既存の参照。規約外のIDだけ引き直す
    if (parsed.answers.length === 0) return formatIdOnly(drawn);
    return formatKeyword({ ...parsed, docId: drawn });
  });

  return { body: nextBody, keywords };
}

/** 保存形式にする（決定表「保存と正規化」列1・列2）。 */
export function collapseBody(body: string): string {
  return rewriteTokens(body, (_token, parsed) =>
    parsed.docId === null ? null : formatIdOnly(parsed.docId),
  );
}

/**
 * 展開形式にする（決定表「保存と正規化」列6）。
 * 章の中で最初に出てくる1か所だけフル形式にし、2回目以降はIDのみのままにする。
 */
export function expandBody(body: string, byId: ReadonlyMap<string, KeywordFields>): string {
  // 前から数えたいので、置き換えとは別に1度走査して最初の出現を決める
  const firstAt = new Map<string, number>();
  for (const token of scanKeywordTokens(body)) {
    const parsed = parseKeywordToken(token.inner);
    if (!parsed?.docId) continue;
    if (!firstAt.has(parsed.docId)) firstAt.set(parsed.docId, token.start);
  }

  return rewriteTokens(body, (token, parsed) => {
    if (parsed.docId === null) return null;
    if (firstAt.get(parsed.docId) !== token.start) return formatIdOnly(parsed.docId);
    const fields = byId.get(parsed.docId);
    if (!fields) return null;
    return formatKeyword({ ...fields, docId: parsed.docId });
  });
}

/**
 * 選択範囲をキーワードにできるか（決定表「編集画面の操作」列4・列5）。
 * 選択が無いとき、既存の記述にかかるときは作れない。
 */
export function canCreateKeyword(body: string, start: number, end: number): boolean {
  if (start >= end) return false;
  return !scanKeywordTokens(body).some((token) => start < token.end && token.start < end);
}

/** ダイアログを確定できるか（決定表「編集画面の操作」列8）。 */
export function canConfirmKeyword(keyword: ParsedKeyword): boolean {
  return keyword.answers.length > 0;
}

/** 範囲を記述に置き換える（決定表「編集画面の操作」列7）。 */
export function applyKeywordToBody(
  body: string,
  start: number,
  end: number,
  keyword: ParsedKeyword,
): string {
  return body.slice(0, start) + formatKeyword(keyword) + body.slice(end);
}

/**
 * キーワードを解除して素のテキストに戻す（決定表「編集画面の操作」列10）。
 * IDのみの記述は正答が本文に無いので、呼び出し側から受け取る。
 */
export function removeKeywordFromBody(
  body: string,
  tokenStart: number,
  fallbackAnswers: readonly string[] = [],
): string {
  const token = scanKeywordTokens(body).find((t) => t.start === tokenStart);
  if (!token) return body;
  const parsed = parseKeywordToken(token.inner);
  const text = parsed?.answers[0] ?? fallbackAnswers[0] ?? '';
  return body.slice(0, token.start) + text + body.slice(token.end);
}
