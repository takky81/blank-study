import { useEffect, useRef, useState, type FormEvent } from 'react';

import { createSubmitGuard } from '@/lib/submitGuard';
import { commitQuestionExchange, exportEligibleQuestions, previewQuestionExchange, type EligibilityExportResult } from './api';
import { validateEligibilityFilter } from './eligibility';
import { downloadExchangeExport, type ExchangeDownloadResult } from './file';
import type { ImportPreview, PreviewItem } from './preview';
import type { EligibilityFilter, EligibilityFilterField, FieldError, QuestionExchangeCommitResult } from './types';
import type { QuestionContentDraft } from '../questions/types';

export type { QuestionExchangeCommitResult } from './types';

export type QuestionExchangePageProps = {
  exportEligible?: (filter: EligibilityFilter) => Promise<EligibilityExportResult>;
  download?: (result: EligibilityExportResult) => ExchangeDownloadResult;
  previewImport?: (file: Blob) => Promise<ImportPreview>;
  /** 既定は`import_question_exchange` gateway。previewImportが返したpreviewと、履歴を引き継ぐ設問IDを渡す。 */
  commitImport?: (preview: ImportPreview, keepHistoryQuestionIds: readonly string[]) => Promise<QuestionExchangeCommitResult>;
};

type ExportState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'downloaded'; fileName: string }
  | { kind: 'error'; message: string };

type ImportState =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'preview-error'; message: string }
  | { kind: 'committing' }
  | { kind: 'commit-error'; message: string }
  | { kind: 'committed'; result: QuestionExchangeCommitResult };

const FIELDS: readonly { field: EligibilityFilterField; label: string; step: string; hint: string }[] = [
  { field: 'minimumAttempts', label: '最低出題回数', step: '1', hint: '0以上の整数' },
  { field: 'maximumAccuracy', label: '最大正答率', step: '0.01', hint: '0〜1（例: 0.6）' },
  { field: 'maximumQuestionCount', label: '最大設問数', step: '1', hint: '0以上の整数' },
];

const KIND_LABELS = { create: '新規', update: '更新', conflict: '競合', error: 'エラー' } as const;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toNumber = (raw: string): unknown => (raw.trim() === '' ? undefined : Number(raw));

function DraftView({ draft }: { draft: QuestionContentDraft }) {
  return <dl className="grid min-w-0 gap-1 text-[13px] [overflow-wrap:anywhere]">
    <dt className="text-muted">設問文</dt><dd>{draft.questionText}</dd>
    <dt className="text-muted">模範解答</dt><dd>{draft.modelAnswer}</dd>
    <dt className="text-muted">選択肢</dt><dd>{draft.choices.join(' / ')}</dd>
    <dt className="text-muted">解説</dt><dd>{draft.explanation ?? 'なし'}</dd>
  </dl>;
}

type KeepHistoryControl = { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void };

function PreviewItemView({ item, keepHistory }: { item: PreviewItem; keepHistory?: KeepHistoryControl }) {
  const position = item.operationIndex === null ? 'ファイル全体' : `操作 ${item.operationIndex + 1}`;
  switch (item.kind) {
    case 'create':
      return <><p className="text-[13px] text-ink-soft">{position}・keyword {item.keywordId}</p><DraftView draft={item.draft} /></>;
    case 'update':
      return <><p className="text-[13px] text-ink-soft">{position}・設問 {item.before.id}（版 {item.before.version}）</p>
        <div className="flex min-w-0 flex-wrap gap-3">
          <div className="min-w-0 grow basis-60"><h4 className="text-[13px] font-bold">変更前</h4><DraftView draft={item.before} /></div>
          <div className="min-w-0 grow basis-60"><h4 className="text-[13px] font-bold">変更後</h4><DraftView draft={item.after} /></div>
        </div>
        {keepHistory && <label className="flex min-h-11 items-center gap-3 text-[13px]">
          <input type="checkbox" className="h-4.5 w-4.5 shrink-0 accent-ink" checked={keepHistory.checked}
            disabled={keepHistory.disabled} onChange={(e) => keepHistory.onChange(e.target.checked)} />
          学習履歴を引き継ぐ（未選択ならリセット）
        </label>}</>;
    case 'conflict':
      return <><p className="text-[13px] text-warn">{position}・設問 {item.current.id} は現在の版 {item.current.version} に更新されています。</p>
        <div className="flex min-w-0 flex-wrap gap-3">
          <div className="min-w-0 grow basis-60"><h4 className="text-[13px] font-bold">現在内容</h4><DraftView draft={item.current} /></div>
          <div className="min-w-0 grow basis-60"><h4 className="text-[13px] font-bold">返却内容</h4><DraftView draft={item.incoming.question} /></div>
        </div></>;
    case 'error':
      return <p className="text-[13px] text-warn [overflow-wrap:anywhere]">{position}・{item.path}: {item.message}</p>;
  }
}

export function QuestionExchangePage({
  exportEligible = exportEligibleQuestions,
  download = (result) => downloadExchangeExport(result),
  previewImport = previewQuestionExchange,
  commitImport = commitQuestionExchange,
}: QuestionExchangePageProps) {
  const [values, setValues] = useState<Record<EligibilityFilterField, string>>({
    minimumAttempts: '3', maximumAccuracy: '0.6', maximumQuestionCount: '3',
  });
  const [requireWrong, setRequireWrong] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<readonly FieldError[]>([]);
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
  // 更新する設問の学習履歴は原則リセットし、ここで選んだ設問IDだけ引き継ぐ。
  const [keepHistoryIds, setKeepHistoryIds] = useState<ReadonlySet<string>>(new Set());
  const exportGuard = useRef(createSubmitGuard());
  const importGuard = useRef(createSubmitGuard());
  const inputRefs = useRef<Partial<Record<EligibilityFilterField, HTMLInputElement | null>>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importErrorRef = useRef<HTMLDivElement | null>(null);

  // 処理中に確定・previewボタンが無効化されfocusが失われるため、失敗時はalertへfocusを移す。
  useEffect(() => {
    if (importState.kind === 'preview-error' || importState.kind === 'commit-error') importErrorRef.current?.focus();
  }, [importState]);

  const runExport = () => {
    const input = {
      minimumAttempts: toNumber(values.minimumAttempts),
      maximumAccuracy: toNumber(values.maximumAccuracy),
      maximumQuestionCount: toNumber(values.maximumQuestionCount),
    };
    const errors = validateEligibilityFilter(input);
    setFieldErrors(errors);
    if (errors.length > 0) {
      const first = errors[0];
      if (first) inputRefs.current[first.field]?.focus();
      return;
    }
    void exportGuard.current.run(async () => {
      setExportState({ kind: 'loading' });
      try {
        const result = await exportEligible({ ...(input as EligibilityFilter), requireWrong });
        if (result.kind === 'empty') { setExportState({ kind: 'empty' }); return; }
        const downloaded = download(result);
        setExportState(downloaded.kind === 'downloaded' ? downloaded : { kind: 'empty' });
      } catch (e) {
        setExportState({ kind: 'error', message: messageOf(e) });
      }
    });
  };

  const onSubmit = (event: FormEvent) => { event.preventDefault(); runExport(); };

  const runPreview = () => {
    if (file === null) return;
    void importGuard.current.run(async () => {
      setImportState({ kind: 'previewing' });
      setPreview(null);
      setKeepHistoryIds(new Set());
      try {
        setPreview(await previewImport(file));
        setImportState({ kind: 'idle' });
      } catch (e) {
        setImportState({ kind: 'preview-error', message: messageOf(e) });
      }
    });
  };

  const runCommit = () => {
    if (preview === null || !preview.canCommit) return;
    const target = preview;
    const keep = target.items.flatMap((i) => (i.kind === 'update' && keepHistoryIds.has(i.before.id) ? [i.before.id] : []));
    void importGuard.current.run(async () => {
      setImportState({ kind: 'committing' });
      try {
        const result = await commitImport(target, keep);
        setPreview(null);
        setKeepHistoryIds(new Set());
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setImportState({ kind: 'committed', result });
      } catch (e) {
        setImportState({ kind: 'commit-error', message: messageOf(e) });
      }
    });
  };

  const cancelPreview = () => { setPreview(null); setImportState({ kind: 'idle' }); };

  const errorFor = (field: EligibilityFilterField) => fieldErrors.find((e) => e.field === field);
  const busyImport = importState.kind === 'previewing' || importState.kind === 'committing';
  const counts = preview === null ? null
    : (['create', 'update', 'conflict', 'error'] as const).map((kind) => ({ kind, count: preview.items.filter((i) => i.kind === kind).length }));

  return <main className="mx-auto flex min-w-0 max-w-4xl flex-col gap-5 p-4 sm:px-10 sm:py-8">
    <header className="min-w-0"><h1 className="text-[22px]">設問交換</h1>
      <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">条件に該当する対象をJSONで出力し、AIで作成した返却ファイルをpreviewしてから取り込みます。</p></header>

    <section aria-labelledby="exchange-export-heading" className="flex min-w-0 flex-col gap-3 rounded border-2 border-line p-4">
      <h2 id="exchange-export-heading" className="text-[17px]">対象の出力</h2>
      <form noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap gap-3">
          {FIELDS.map(({ field, label, step, hint }) => {
            const error = errorFor(field);
            const id = `exchange-${field}`;
            return <div key={field} className="flex min-w-0 grow basis-40 flex-col gap-1">
              <label htmlFor={id} className="text-[13px] font-bold">{label}</label>
              <input id={id} ref={(el) => { inputRefs.current[field] = el; }} type="number" inputMode="decimal" min="0" step={step}
                value={values[field]} onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                aria-invalid={error ? 'true' : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
                className="min-w-0 rounded border-2 border-line bg-transparent px-2 py-1" />
              <span id={`${id}-hint`} className="text-[12px] text-muted">{hint}</span>
              {error && <span id={`${id}-error`} className="text-[12px] text-warn [overflow-wrap:anywhere]">{error.message}</span>}
            </div>;
          })}
        </div>
        <label className="flex min-h-11 min-w-0 items-center gap-3 text-[13px]">
          <input type="checkbox" className="h-4.5 w-4.5 shrink-0 accent-ink" checked={requireWrong}
            onChange={(e) => setRequireWrong(e.target.checked)} />
          <span className="min-w-0 [overflow-wrap:anywhere]">誤答が1回以上ある用語に限る（外すと全問正解の用語も成績条件の対象にする）</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-p" aria-busy={exportState.kind === 'loading'}>対象を出力</button>
        </div>
      </form>
      {exportState.kind === 'loading' && <p role="status" aria-live="polite" className="text-[13px] text-muted">対象を抽出中…</p>}
      {exportState.kind === 'empty' && <p role="status" className="text-[13px] text-muted">条件に該当する対象はありません。ファイルは出力していません。</p>}
      {exportState.kind === 'downloaded' && <p role="status" className="text-[13px] [overflow-wrap:anywhere]">{exportState.fileName} を出力しました。</p>}
      {exportState.kind === 'error' && <div role="alert" className="flex flex-wrap items-center gap-3 rounded border-2 border-warn bg-warn-panel p-3 text-[13px] text-warn">
        <span className="min-w-0 grow [overflow-wrap:anywhere]">{exportState.message}。条件を確認して再試行してください。</span>
        <button type="button" onClick={runExport} className="btn-s border-warn text-warn">出力を再試行</button></div>}
    </section>

    <section aria-labelledby="exchange-import-heading" className="flex min-w-0 flex-col gap-3 rounded border-2 border-line p-4">
      <h2 id="exchange-import-heading" className="text-[17px]">返却ファイルの取込</h2>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="flex min-w-0 grow flex-col gap-1">
          <label htmlFor="exchange-file" className="text-[13px] font-bold">返却ファイル（JSON）</label>
          <input id="exchange-file" ref={fileInputRef} type="file" accept="application/json,.json" className="min-w-0 max-w-full text-[13px]"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setImportState({ kind: 'idle' }); }} />
        </div>
        <button type="button" onClick={runPreview} disabled={file === null} className="btn" aria-busy={importState.kind === 'previewing'}>previewを作成</button>
      </div>
      {file && <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">選択中: {file.name}</p>}
      {importState.kind === 'previewing' && <p role="status" aria-live="polite" className="text-[13px] text-muted">previewを作成中…</p>}
      {importState.kind === 'preview-error' && <div role="alert" ref={importErrorRef} tabIndex={-1} className="flex flex-wrap items-center gap-3 rounded border-2 border-warn bg-warn-panel p-3 text-[13px] text-warn">
        <span className="min-w-0 grow [overflow-wrap:anywhere]">{importState.message}。ファイルを確認して再試行してください。</span>
        <button type="button" onClick={runPreview} className="btn-s border-warn text-warn">previewを再試行</button></div>}
      {importState.kind === 'committed' && <p role="status" className="text-[13px]">
        取込を確定しました: 追加 {importState.result.created}件、更新 {importState.result.updated}件、疑義解除 {importState.result.doubtFlagsCleared}件、解説依頼解除 {importState.result.explanationRequestFlagsCleared}件、履歴リセット {importState.result.historyReset}件。previewを破棄しました。最新の状態を再読込するには、対象を再出力するか返却ファイルを選び直してください。</p>}

      {preview && counts && <section aria-label="取込preview" className="flex min-w-0 flex-col gap-3">
        <ul className="flex min-w-0 flex-wrap gap-2" aria-label="区分別件数">
          {counts.map(({ kind, count }) => <li key={kind} className={`rounded border-2 px-2 py-1 text-[13px] ${(kind === 'conflict' || kind === 'error') && count > 0 ? 'border-warn text-warn' : 'border-line'}`}>{KIND_LABELS[kind]} {count}件</li>)}
        </ul>
        {!preview.canCommit && <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[13px] text-warn">
          競合またはエラーがあるため取り込めません。返却ファイルを修正するか、最新の内容で再出力してください。</p>}
        {counts.some((c) => c.kind === 'update' && c.count > 0) && <p className="text-[13px] text-ink-soft [overflow-wrap:anywhere]">
          更新する設問の学習履歴（出題回数・正答数・復習予定）は取込時にリセットします。引き継ぐ設問だけチェックしてください。</p>}
        <ol className="flex min-w-0 flex-col gap-3">
          {preview.items.map((item, index) => <li key={index} className="flex min-w-0 flex-col gap-2 rounded border-2 border-line p-3">
            <h3 className="text-[13px] font-bold">{KIND_LABELS[item.kind]}</h3><PreviewItemView item={item}
              keepHistory={item.kind === 'update' ? {
                checked: keepHistoryIds.has(item.before.id), disabled: busyImport,
                onChange: (checked) => setKeepHistoryIds((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(item.before.id); else next.delete(item.before.id);
                  return next;
                }),
              } : undefined} /></li>)}
        </ol>
        {importState.kind === 'committing' && <p role="status" aria-live="polite" className="text-[13px] text-muted">取込中…</p>}
        {importState.kind === 'commit-error' && <div role="alert" ref={importErrorRef} tabIndex={-1} className="rounded border-2 border-warn bg-warn-panel p-3 text-[13px] text-warn [overflow-wrap:anywhere]">
          {importState.message}。previewは保持しています。再試行するか、取り消して再出力してください。</div>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={runCommit} disabled={!preview.canCommit || busyImport} className="btn-p">取込を確定</button>
          <button type="button" onClick={cancelPreview} disabled={busyImport} className="btn">取消</button>
        </div>
      </section>}
    </section>
  </main>;
}
