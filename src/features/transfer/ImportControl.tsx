import { useRef, useState } from 'react';
import {
  materialNameOf,
  prepareImport,
  runImport,
  type ImportPlan,
  type ImportTarget,
  type Resolutions,
} from './api';

/**
 * zip の取り込み。決定表「インポートの単位」「インポート時のキーワード突合」に対応する。
 * 食い違いがあるときだけ差分確認を出し、無ければそのまま取り込む（突合列10）。
 */
export function ImportControl({
  label,
  testId,
  target,
  onDone,
  onError,
}: {
  label: string;
  testId: string;
  /** ファイル名から教材名を決めるので、教材まるごとのときは名前を後から入れる */
  target: (fileName: string) => ImportTarget;
  onDone: (materialId: string) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const prepared = await prepareImport(bytes, target(materialNameOf(file.name)));
      if (prepared.conflicts.length === 0) {
        onDone(await runImport(prepared));
        return;
      }
      // 既定は登録済みを残す。取り込む側を選ぶのは明示の操作にする
      setResolutions(Object.fromEntries(prepared.conflicts.map((c) => [c.docId, false])));
      setPlan(prepared);
    } catch (e) {
      onError(e instanceof Error ? e.message : '取り込みに失敗しました');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    try {
      const materialId = await runImport(plan, resolutions);
      setPlan(null);
      onDone(materialId);
    } catch (e) {
      onError(e instanceof Error ? e.message : '取り込みに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="inline-flex h-11 cursor-pointer items-center rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300">
        {label}
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          data-testid={testId}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pick(file);
          }}
        />
      </label>

      {plan && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="取り込む内容の確認"
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-6"
        >
          <div className="flex max-h-dvh w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-t-lg border-2 border-stone-900 bg-stone-50 p-5 sm:rounded-lg dark:border-stone-100 dark:bg-stone-900">
            <h2 className="text-lg">取り込む内容の確認</h2>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              登録済みの内容と食い違うキーワードがあります。どちらを残すか選んでください。
            </p>

            <ul className="flex flex-col gap-3">
              {plan.conflicts.map((conflict) => (
                <li
                  key={conflict.docId}
                  className="flex flex-col gap-2 rounded border-2 border-stone-900 bg-white p-3 dark:border-stone-100 dark:bg-stone-800"
                >
                  <span className="font-mono text-xs text-stone-500">id={conflict.docId}</span>
                  <div className="flex flex-col gap-1 text-sm sm:flex-row sm:gap-6">
                    <span className="grow">
                      登録済み: {conflict.current?.answers.join('、') ?? 'なし'}
                    </span>
                    <span className="grow">取り込む側: {conflict.incoming.answers.join('、')}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-pressed={resolutions[conflict.docId] === true}
                      onClick={() => setResolutions((r) => ({ ...r, [conflict.docId]: true }))}
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
                      onClick={() => setResolutions((r) => ({ ...r, [conflict.docId]: false }))}
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
                onClick={() => setPlan(null)}
                disabled={busy}
                className="h-11 rounded border-2 border-stone-900 px-4 disabled:opacity-40 dark:border-stone-100"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy}
                className="h-11 rounded border-2 border-stone-900 bg-stone-900 px-5 text-stone-50 disabled:opacity-40 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
              >
                {busy ? '取り込んでいます…' : '適用'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
