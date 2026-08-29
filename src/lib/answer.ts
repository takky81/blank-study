/**
 * 正誤判定。決定表「正誤判定」に対応する。
 * docs/仕様書.md §5.2 の定数と合わせて読むこと。
 */

/**
 * 比較のための正規化。
 * 1. 前後の空白を除去する
 * 2. 英数字・記号の全角を半角に変換する
 * 3. 英字の大文字小文字を同一視する
 */
export function normalizeAnswer(value: string): string {
  return value
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .trim()
    .toLowerCase();
}

/** 空欄・空白だけの入力は解答として受け付けない。 */
export function isAnswerable(input: string): boolean {
  return normalizeAnswer(input) !== '';
}

/** 入力が正答のいずれかと一致するか。正答はすべて対等に扱う。 */
export function judge(input: string, answers: readonly string[]): boolean {
  const normalized = normalizeAnswer(input);
  if (normalized === '') return false;
  return answers.some((answer) => normalizeAnswer(answer) === normalized);
}

/**
 * 表示範囲の中で、解答者の入力と一致するキーワードを探す。
 * 不正解のときに「答えた語が入る位置」を橙で示すために使う。
 */
export function matchesInput(input: string, answers: readonly string[]): boolean {
  return judge(input, answers);
}
