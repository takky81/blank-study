/**
 * PC版（広い画面）の設問学習で使うショートカットキーの共通部品。
 * 入力欄で文字を打っているとき・修飾キー併用・キーリピートでは反応しない。
 */
export function isShortcutTarget(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false;
  if (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type)) return false;
  // フォーカス中のボタン・リンクではEnterをブラウザ標準の押下に任せる。
  if (event.key === 'Enter' && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) return false;
  return true;
}

/** ラベル前のキー名（`[1] `）。読み上げ名を変えないよう支援技術からは隠す。 */
export function KeyHint({ label }: { label: string }) {
  return <span aria-hidden="true" className="shrink-0 font-mono text-muted">[{label}] </span>;
}
