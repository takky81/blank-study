/**
 * 本文の Markdown を読む。決定表「編集画面の操作」列1・列14 に対応する。
 *
 * 扱うのは学習ノートに要る範囲だけ。見出し・箇条書き・引用・コード・
 * 強調・リンク、そしてキーワードの記述を空欄にすること。
 * 画像は描画せず記述のまま残す（初版は画像を扱わない）。
 *
 * 位置（start / end）は本文の先頭からの位置。空欄をクリックしたときに
 * 本文のどこを書き換えればよいか分かるようにするため。
 */

import { scanKeywordTokens, parseKeywordToken } from './keyword';

export type Blank = {
  type: 'blank';
  start: number;
  end: number;
  docId: string | null;
  answers: string[];
  tags: string[];
  wrongChoices: string[];
};

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | Blank;

export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'quote'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; text: string };

/** 本文の中の1区間。位置を保ったまま切り出すために持ち回る。 */
type Span = { text: string; offset: number };

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```/;

/** 行に切り分ける。位置を保つため、行ごとの開始位置も持たせる。 */
function toLines(body: string): Span[] {
  const lines: Span[] = [];
  let offset = 0;
  for (const text of body.split('\n')) {
    lines.push({ text, offset });
    offset += text.length + 1;
  }
  return lines;
}

export function parseMarkdown(body: string): Block[] {
  const lines = toLines(body);
  const blocks: Block[] = [];
  let i = 0;

  /** 連続する行をまとめて1つの区間にする。段落と引用の中の改行は保つ。 */
  const joinSpans = (spans: Span[]): Span => {
    const first = spans[0];
    if (!first) return { text: '', offset: 0 };
    const last = spans[spans.length - 1] as Span;
    return { text: body.slice(first.offset, last.offset + last.text.length), offset: first.offset };
  };

  while (i < lines.length) {
    const line = lines[i] as Span;

    if (line.text.trim() === '') {
      i += 1;
      continue;
    }

    if (FENCE.test(line.text)) {
      const start = i + 1;
      let end = start;
      while (end < lines.length && !FENCE.test((lines[end] as Span).text)) end += 1;
      const inner = lines.slice(start, end).map((l) => l.text);
      blocks.push({ type: 'code', text: inner.join('\n') });
      i = end + 1;
      continue;
    }

    const heading = HEADING.exec(line.text);
    if (heading) {
      const level = (heading[1] as string).length;
      const text = heading[2] as string;
      blocks.push({
        type: 'heading',
        level,
        children: parseInline({ text, offset: line.offset + line.text.length - text.length }),
      });
      i += 1;
      continue;
    }

    if (UNORDERED.test(line.text) || ORDERED.test(line.text)) {
      const ordered = ORDERED.test(line.text);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const current = lines[i] as Span;
        const matched = ordered ? ORDERED.exec(current.text) : UNORDERED.exec(current.text);
        if (!matched) break;
        const text = matched[1] as string;
        items.push(
          parseInline({ text, offset: current.offset + current.text.length - text.length }),
        );
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (QUOTE.test(line.text)) {
      const spans: Span[] = [];
      while (i < lines.length) {
        const current = lines[i] as Span;
        const matched = QUOTE.exec(current.text);
        if (!matched) break;
        const text = matched[1] as string;
        spans.push({ text, offset: current.offset + current.text.length - text.length });
        i += 1;
      }
      // 引用は行ごとに接頭辞を外すので、位置は最初の行のものを使う
      const joined = spans.map((s) => s.text).join('\n');
      blocks.push({
        type: 'quote',
        children: parseInline({ text: joined, offset: (spans[0] as Span).offset }),
      });
      continue;
    }

    const paragraph: Span[] = [];
    while (i < lines.length) {
      const current = lines[i] as Span;
      if (
        current.text.trim() === '' ||
        FENCE.test(current.text) ||
        HEADING.test(current.text) ||
        QUOTE.test(current.text) ||
        UNORDERED.test(current.text) ||
        ORDERED.test(current.text)
      ) {
        break;
      }
      paragraph.push(current);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(joinSpans(paragraph)) });
  }

  return blocks;
}

const CODE = /`([^`]+)`/;
const STRONG = /\*\*([^*]+)\*\*/;
const EM = /\*([^*]+)\*/;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/;
const LINK = /\[([^\]]*)\]\(([^)]*)\)/;

/** 先に見つかった記法から順に切り分ける。 */
function parseInline(span: Span): Inline[] {
  if (span.text === '') return [];

  const blanks = scanKeywordTokens(span.text)
    .map((token) => ({ token, parsed: parseKeywordToken(token.inner) }))
    .filter((t) => t.parsed !== null);

  const candidates: { at: number; length: number; build: () => Inline }[] = [];

  for (const { token, parsed } of blanks) {
    candidates.push({
      at: token.start,
      length: token.end - token.start,
      build: () => ({
        type: 'blank',
        start: span.offset + token.start,
        end: span.offset + token.end,
        docId: parsed?.docId ?? null,
        answers: parsed?.answers ?? [],
        tags: parsed?.tags ?? [],
        wrongChoices: parsed?.wrongChoices ?? [],
      }),
    });
  }

  const push = (
    pattern: RegExp,
    build: (matched: RegExpExecArray, at: number) => Inline,
  ): void => {
    const matched = pattern.exec(span.text);
    if (!matched) return;
    candidates.push({
      at: matched.index,
      length: matched[0].length,
      build: () => build(matched, matched.index),
    });
  };

  push(CODE, (m) => ({ type: 'code', text: m[1] as string }));
  push(STRONG, (m) => ({
    type: 'strong',
    children: parseInline({ text: m[1] as string, offset: span.offset + m.index + 2 }),
  }));
  push(EM, (m) => ({
    type: 'em',
    children: parseInline({ text: m[1] as string, offset: span.offset + m.index + 1 }),
  }));
  // 画像は記述のまま残す（列14）。リンクの記法に食われないよう先に押さえる
  push(IMAGE, (m) => ({ type: 'text', text: m[0] }));
  push(LINK, (m) => ({
    type: 'link',
    href: m[2] as string,
    children: parseInline({ text: m[1] as string, offset: span.offset + m.index + 1 }),
  }));

  if (candidates.length === 0) return [{ type: 'text', text: span.text }];

  // 同じ位置で始まるものは長い方を採る（** が * に食われないようにする）
  candidates.sort((a, b) => a.at - b.at || b.length - a.length);
  const chosen = candidates[0] as (typeof candidates)[number];

  const before = span.text.slice(0, chosen.at);
  const afterAt = chosen.at + chosen.length;
  const after = span.text.slice(afterAt);

  return [
    ...(before === '' ? [] : parseInline({ text: before, offset: span.offset })),
    chosen.build(),
    ...(after === '' ? [] : parseInline({ text: after, offset: span.offset + afterAt })),
  ];
}
