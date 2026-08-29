import { useRef, useState } from 'react';
import { ConflictDialog } from '@/components/ConflictDialog';
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
      <label className="inline-flex h-11 cursor-pointer items-center rounded border border-edge px-3 text-[13px] text-ink-soft">
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
        <ConflictDialog
          conflicts={plan.conflicts}
          resolutions={resolutions}
          onChange={(docId, overwrite) => setResolutions((r) => ({ ...r, [docId]: overwrite }))}
          onApply={() => void apply()}
          onCancel={() => setPlan(null)}
          busy={busy}
          description="登録済みの内容と食い違うキーワードがあります。どちらを残すか選んでください。"
        />
      )}
    </>
  );
}
