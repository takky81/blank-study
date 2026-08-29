/**
 * ログインフォームの検査。決定表「認証」列7・列8 に対応する。
 */

/**
 * メールアドレスの形式。
 * ローカル部に空白を許さず、ドメインにドットを1つ以上求める。
 * 認証そのものはサーバー側が判断するので、ここは打ち間違いを早く伝えるための検査。
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * ログインを押せるか。
 * 空欄だけを見る。形式の誤りは押したあとに伝える（押せないと理由が分からないため）。
 */
export function canSubmitLogin(email: string, password: string): boolean {
  return email.trim() !== '' && password !== '';
}

/**
 * 認証の失敗が「サーバーに届かなかった」ものかを見る（決定表「認証」列9）。
 * 通信の失敗は投げられることも、エラーとして返ることもある。
 * 返ってきた場合に資格情報の誤りと同じ文言を出すと、原因を取り違えるため区別する。
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const { name, status } = error as { name?: string; status?: number };
  // status 0 はサーバーの応答が無かったことを表す
  return name === 'AuthRetryableFetchError' || name === 'TypeError' || status === 0;
}
