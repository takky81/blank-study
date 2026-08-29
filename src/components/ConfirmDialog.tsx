import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 確認ダイアログ。
 * 画面幅が狭いときは全画面のシートにする（決定表「表示設定と共通の振る舞い」列6）。
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'キャンセル',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center sm:p-6"
    >
      <div className="flex max-h-full w-full flex-col gap-4 overflow-auto border-2 border-ink bg-panel p-6 sm:max-w-lg sm:rounded-md">
        <h2 className="text-[17px]">{title}</h2>
        <div className="text-[13px] leading-[1.9] text-ink-soft">{children}</div>
        <div className="flex justify-end gap-3 pt-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="btn">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              destructive
                ? 'flex h-11 items-center justify-center rounded border-2 border-warn bg-warn px-5 text-[15px] text-paper disabled:opacity-40'
                : 'btn-p'
            }
          >
            {busy ? '処理しています…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
