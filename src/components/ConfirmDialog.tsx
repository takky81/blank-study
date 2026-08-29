import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 確認ダイアログ。
 * 画面幅が狭いときは全画面のシートにする（決定表「表示設定と共通の振る舞い」列6）。
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-6"
    >
      <div className="flex max-h-full w-full flex-col gap-4 overflow-auto border-2 border-stone-900 bg-stone-50 p-6 sm:max-w-md sm:rounded-lg dark:border-stone-100 dark:bg-stone-900">
        <h2 className="text-lg">{title}</h2>
        <div className="text-sm leading-relaxed text-stone-600 dark:text-stone-300">{children}</div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-11 rounded border-2 border-stone-900 px-4 disabled:opacity-40 dark:border-stone-100"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              destructive
                ? 'h-11 rounded border-2 border-orange-700 bg-orange-700 px-4 text-stone-50 disabled:opacity-40'
                : 'h-11 rounded border-2 border-stone-900 bg-stone-900 px-4 text-stone-50 disabled:opacity-40 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
            }
          >
            {busy ? '処理しています…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
