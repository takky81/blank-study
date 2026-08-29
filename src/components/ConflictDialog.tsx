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
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center sm:p-6"
    >
      <div className="flex max-h-dvh w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-t-md border-2 border-ink bg-panel p-6 sm:rounded-md">
        <h2 className="text-[17px]">正答が一致しないキーワードがあります</h2>
        <p className="text-[13px] text-ink-soft">{description}</p>

        <ul className="flex flex-col gap-3">
          {conflicts.map((conflict) => (
            <li key={conflict.docId} className="card flex flex-col gap-3 p-4">
              <span className="font-mono text-[12px] text-muted">id = {conflict.docId}</span>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex min-w-0 grow basis-0 flex-col gap-1 rounded-[5px] border-[1.5px] border-line px-3 py-2.5">
                  <span className="text-[11px] text-muted">登録済み</span>
                  <span className="text-[14px]">
                    {conflict.current?.answers.join(' ・ ') ?? 'なし'}
                  </span>
                </div>
                <div className="flex min-w-0 grow basis-0 flex-col gap-1 rounded-[5px] border-[1.5px] border-line px-3 py-2.5">
                  <span className="text-[11px] text-muted">取り込む内容</span>
                  <span className="text-[14px]">{conflict.incoming.answers.join(' ・ ')}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={resolutions[conflict.docId] === true}
                  onClick={() => onChange(conflict.docId, true)}
                  className={
                    resolutions[conflict.docId] === true ? 'btn-p grow text-[13px]' : 'btn-s grow'
                  }
                >
                  取り込んだ内容にする
                </button>
                <button
                  type="button"
                  aria-pressed={resolutions[conflict.docId] !== true}
                  onClick={() => onChange(conflict.docId, false)}
                  className={
                    resolutions[conflict.docId] !== true ? 'btn-p grow text-[13px]' : 'btn-s grow'
                  }
                >
                  登録済みを残す
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="btn">
            やめる
          </button>
          <button type="button" onClick={onApply} disabled={busy} className="btn-p">
            {busy ? '処理しています…' : '適用'}
          </button>
        </div>
      </div>
    </div>
  );
}
