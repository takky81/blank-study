/**
 * キーワード埋め込み記法のパース。決定表「キーワード記法のパース」に対応する。
 * 書式は docs/仕様書.md §4.1 / §4.2 を参照。
 *
 *   {{正答1,正答2|id=a3f9k2|tags=タグ1,タグ2|wrong=誤答1,誤答2}}
 */

/** ドキュメントに埋め込まれるIDの形式（仕様書 §5.2）。 */
export const DOC_ID_PATTERN = /^[a-z0-9]{6}$/;

export type ParsedKeyword = {
  /** 正答。id のみの記述では空になり、既存のキーワードを参照する意味になる */
  answers: string[];
  /** 記述に id が無ければ null。保存時・インポート時に採番する */
  docId: string | null;
  tags: string[];
  wrongChoices: string[];
};

export type KeywordToken = {
  /** 本文中の開始位置（{{ の位置） */
  start: number;
  /** 本文中の終了位置（}} の直後） */
  end: number;
  /** 括弧の中身 */
  inner: string;
};

const KNOWN_KEYS = new Set(['id', 'tags', 'wrong']);

/**
 * 本文から記述を切り出す。
 * クォートの中の区切り文字と閉じ括弧は区切りとして扱わない。
 * 閉じ括弧が無いまま改行または本文の末尾に達した記述は取り出さない。
 */
export function scanKeywordTokens(body: string): KeywordToken[] {
  const tokens: KeywordToken[] = [];
  let i = 0;

  while (i < body.length - 1) {
    if (!(body[i] === '{' && body[i + 1] === '{')) {
      i += 1;
      continue;
    }

    const start = i;
    let j = i + 2;
    let inQuote = false;
    let closed = false;

    while (j < body.length) {
      const c = body[j];
      if (c === '\n') break; // 記述は1行に収める
      if (c === '"') {
        // クォートの中の "" は1つのクォートを表す。囲みの外に出ない。
        if (inQuote && body[j + 1] === '"') {
          j += 2;
          continue;
        }
        inQuote = !inQuote;
        j += 1;
        continue;
      }
      if (!inQuote && c === '}' && body[j + 1] === '}') {
        tokens.push({ start, end: j + 2, inner: body.slice(start + 2, j) });
        i = j + 2;
        closed = true;
        break;
      }
      j += 1;
    }

    if (!closed) i = start + 2;
  }

  return tokens;
}

/**
 * クォートを考慮して1文字の区切りで分割する。クォートは外さない。
 * `|` で分けたあと `,` で分ける2段構えになるため、
 * 引用符の解除は末端の unquote に一度だけ任せる。
 */
function splitKeepingQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < value.length; i += 1) {
    const c = value[i]!;
    if (c === '"') {
      if (inQuote && value[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      inQuote = !inQuote;
      current += c;
      continue;
    }
    if (!inQuote && c === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

/** 引用符を解除する。クォートの中の連続したクォートは1つのクォートを表す。 */
function unquote(value: string): string {
  let out = '';
  let inQuote = false;

  for (let i = 0; i < value.length; i += 1) {
    const c = value[i]!;
    if (c === '"') {
      if (inQuote && value[i + 1] === '"') {
        out += '"';
        i += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    out += c;
  }
  return out;
}

/** 値のリストを読む。前後の空白を落とし、空の要素と重複を除く。 */
function readList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of splitKeepingQuotes(value, ',')) {
    const item = unquote(raw.trim());
    if (item === '' || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** 第1セグメントが正答リストか、それとも key=value かを見分ける。 */
function isKeyValueSegment(segment: string): boolean {
  const eq = segment.indexOf('=');
  if (eq < 0) return false;
  return KNOWN_KEYS.has(segment.slice(0, eq).trim());
}

/**
 * 記述の中身を読む。キーワードとして認識できない場合は null を返す。
 * 未知のキーは読み飛ばし、同じキーが複数あれば最後の値を採る。
 */
export function parseKeywordToken(inner: string): ParsedKeyword | null {
  if (inner.includes('\n')) return null;

  const segments = splitKeepingQuotes(inner, '|');
  const first = segments[0] ?? '';

  let answers: string[] = [];
  let rest = segments;

  if (!isKeyValueSegment(first)) {
    answers = readList(first);
    rest = segments.slice(1);
  }

  let docId: string | null = null;
  let tags: string[] = [];
  let wrongChoices: string[] = [];

  for (const segment of rest) {
    const eq = segment.indexOf('=');
    if (eq < 0) continue;
    const key = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1);
    if (key === 'id') docId = unquote(value.trim());
    else if (key === 'tags') tags = readList(value);
    else if (key === 'wrong') wrongChoices = readList(value);
    // 未知のキーは無視する
  }

  // 正答リストは id のみの形を除いて必須
  if (answers.length === 0 && docId === null) return null;

  return { answers, docId, tags, wrongChoices };
}

/** 記述された id が規約に沿うか。沿わないものは採番し直す。 */
export function isValidDocId(docId: string): boolean {
  return DOC_ID_PATTERN.test(docId);
}
