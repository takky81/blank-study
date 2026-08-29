import type { Conflict } from '@/features/transfer/match';

/**
 * 差分確認。保存とインポートで共用する（仕様書 §6）。
 * 決定表「保存時の上書き確認」列4・列5・列7、
 * 「インポート時のキーワード突合」列6・列7 に対応する。
 */
export function ConflictDialog({
  conflicts,
  resolutions,
  onChange,
  onApply,
  onCancel,
  busy = false,
  description,
}: {
  conflicts: readonly Conflict[];
  /** docId ごとに true なら取り込む側で上書きする */
  resolutions: Record<string, boolean>;
  onChange: (docId: string, overwrite: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
  busy?: boolean;
  description: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="取り込む内容の確認"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-6"
    >
      <div className="flex max-h-dvh w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-t-lg border-2 border-stone-900 bg-stone-50 p-5 sm:rounded-lg dark:border-stone-100 dark:bg-stone-900">
        <h2 className="text-lg">内容の確認</h2>
        <p className="text-sm text-stone-600 dark:text-stone-300">{description}</p>

        <ul className="flex flex-col gap-3">
          {conflicts.map((conflict) => (
            <li
              key={conflict.docId}
              className="flex flex-col gap-2 rounded border-2 border-stone-900 bg-white p-3 dark:border-stone-100 dark:bg-stone-800"
            >
              <span className="font-mono text-xs text-stone-500">id={conflict.docId}</span>
              <div className="flex flex-col gap-1 text-sm sm:flex-row sm:gap-6">
                <span className="grow">
                  登録済み: {conflict.current?.answers.join('、') ?? 'なし'}
                </span>
                <span className="grow">新しい内容: {conflict.incoming.answers.join('、')}</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={resolutions[conflict.docId] === true}
                  onClick={() => onChange(conflict.docId, true)}
                  className={
                    resolutions[conflict.docId] === true
                      ? 'h-11 grow rounded border-2 border-stone-900 bg-stone-900 px-3 text-sm text-stone-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                      : 'h-11 grow rounded border border-stone-400 px-3 text-sm'
                  }
                >
                  取り込んだ内容にする
                </button>
                <button
                  type="button"
                  aria-pressed={resolutions[conflict.docId] !== true}
                  onClick={() => onChange(conflict.docId, false)}
                  className={
                    resolutions[conflict.docId] !== true
                      ? 'h-11 grow rounded border-2 border-stone-900 bg-stone-900 px-3 text-sm text-stone-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                      : 'h-11 grow rounded border border-stone-400 px-3 text-sm'
                  }
                >
                  登録済みを残す
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-11 rounded border-2 border-stone-900 px-4 disabled:opacity-40 dark:border-stone-100"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            className="h-11 rounded border-2 border-stone-900 bg-stone-900 px-5 text-stone-50 disabled:opacity-40 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
          >
            {busy ? '処理しています…' : '適用'}
          </button>
        </div>
      </div>
    </div>
  );
}
