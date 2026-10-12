/**
 * 疑義の理由（固定コード）。この配列の順序が正規順であり、DB・設問バンク・学習UI・設問交換で共通に使う。
 * 保存・交換するのはコードで、表示ラベルはここだけで定義する。
 */
export const DOUBT_REASONS = [
  { code: 'answer_guessable', label: '知識がなくても解ける（問題文や選択肢から推測できる）' },
  { code: 'low_value', label: '問う価値が低い' },
  { code: 'defective', label: '問題不備（正解・問題文の誤り、正解が一つに決まらない）' },
  { code: 'unclear', label: '問題文が分かりにくい' },
] as const;

export type DoubtReason = (typeof DOUBT_REASONS)[number]['code'];

export const DOUBT_REASON_CODES: readonly DoubtReason[] = DOUBT_REASONS.map((r) => r.code);

export function isDoubtReason(value: unknown): value is DoubtReason {
  return typeof value === 'string' && (DOUBT_REASON_CODES as readonly string[]).includes(value);
}

/** 正規順・重複なしへ整える。 */
export function normalizeDoubtReasons(values: readonly DoubtReason[]): DoubtReason[] {
  return DOUBT_REASON_CODES.filter((code) => values.includes(code));
}

export function doubtReasonLabel(code: DoubtReason): string {
  return DOUBT_REASONS.find((r) => r.code === code)?.label ?? code;
}
