import { useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RowActions } from '@/components/RowActions';
import type { DeleteQuestionResult, MutationResult, QuestionVersionToken, ReorderQuestionResult, StructuredQuestion } from './types';
import { isQuestionBankOperationCancelled } from './operationCancellation';

export type QuestionFlagName = 'doubtFlag' | 'explanationRequestFlag';
export type QuestionListProps = {
  questions: readonly StructuredQuestion[];
  onEdit: (question: StructuredQuestion) => void;
  onReorder: (ordered: readonly QuestionVersionToken[]) => Promise<ReorderQuestionResult>;
  onSetActive: (question: StructuredQuestion, active: boolean) => Promise<MutationResult>;
  onClearFlag: (question: StructuredQuestion, flag: QuestionFlagName) => Promise<MutationResult>;
  onDelete: (question: StructuredQuestion) => Promise<DeleteQuestionResult>;
  onVersionConflict: (current: StructuredQuestion) => void;
};
type DialogAction = { kind: 'active' | 'delete'; question: StructuredQuestion; opener: HTMLButtonElement };
type Notice = { kind: 'status' | 'error'; message: string } | null;
const token = (question: StructuredQuestion): QuestionVersionToken => ({ id: question.id, version: question.version, updatedAt: question.updatedAt });

export function QuestionList({ questions, onEdit, onReorder, onSetActive, onClearFlag, onDelete, onVersionConflict }: QuestionListProps) {
  const ordered = useMemo(() => [...questions].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)), [questions]);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current += 1; busyRef.current = false; };
  }, []);

  function closeDialog() { const opener = dialog?.opener; setDialog(null); opener?.focus(); }
  function conflict(current: StructuredQuestion) {
    retryRef.current = null;
    setNotice({ kind: 'error', message: `操作できませんでした。サーバー上の現在の版は ${current.version} です。再読込して確認してください。` });
    onVersionConflict(current);
  }
  function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    retryRef.current = () => run(action);
    busyRef.current = true; setBusy(true); setNotice(null);
    const operation = ++operationRef.current;
    void action().catch((caught: unknown) => {
      if (!mountedRef.current || operationRef.current !== operation || isQuestionBankOperationCancelled(caught)) return;
      setNotice({ kind: 'error', message: caught instanceof Error ? caught.message : '設問の操作に失敗しました。' });
    }).finally(() => {
      if (!mountedRef.current || operationRef.current !== operation) return;
      busyRef.current = false; setBusy(false);
    });
  }
  function finish(message: string) { retryRef.current = null; setNotice({ kind: 'status', message }); }
  function runMutation(request: () => Promise<MutationResult>, message: string) {
    run(async () => { const result = await request(); if (!mountedRef.current) return; result.kind === 'version-conflict' ? conflict(result.current) : finish(`${message}（版 ${result.question.version}）`); });
  }
  function move(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (destination < 0 || destination >= ordered.length) return;
    const reordered = [...ordered]; const [moving] = reordered.splice(index, 1);
    if (!moving) return;
    reordered.splice(destination, 0, moving);
    run(async () => {
      const result = await onReorder(reordered.map(token));
      if (!mountedRef.current) return;
      if ('kind' in result && result.kind === 'version-conflict') conflict(result.current);
      else finish('設問を並べ替えました');
    });
  }
  function confirmAction() {
    if (!dialog) return;
    const action = dialog;
    if (action.kind === 'delete') {
      run(async () => { const result = await onDelete(action.question); if (!mountedRef.current) return; closeDialog(); result === 'deleted' ? finish('設問を削除しました') : conflict(result.current); });
    } else {
      const active = !action.question.isActive;
      run(async () => { const result = await onSetActive(action.question, active); if (!mountedRef.current) return; closeDialog(); result.kind === 'version-conflict' ? conflict(result.current) : finish(`設問を${active ? '有効' : '無効'}にしました（版 ${result.question.version}）`); });
    }
  }

  return <section aria-label="設問一覧" className="min-w-0">
    <ul className="flex min-w-0 flex-col gap-3">
      {ordered.map((question, index) => <li key={question.id} className="card relative flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="min-w-0 grow">
          <h3 className="[overflow-wrap:anywhere] text-[17px]">{question.questionText}</h3>
          <dl className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">
            <div><dt className="inline">状態: </dt><dd className="inline">{question.isActive ? '有効' : '無効'}</dd></div>
            <div><dt className="inline">解説: </dt><dd className="inline">{question.explanation === null ? 'なし' : 'あり'}</dd></div>
            <div><dt className="inline">疑義フラグ: </dt><dd className="inline">{question.doubtFlag ? 'あり' : 'なし'}</dd></div>
            <div><dt className="inline">解説追加フラグ: </dt><dd className="inline">{question.explanationRequestFlag ? 'あり' : 'なし'}</dd></div>
            {question.doubtFlag && question.doubtNote !== null && <div className="basis-full min-w-0"><dt className="inline">疑義の内容: </dt><dd className="inline whitespace-pre-wrap [overflow-wrap:anywhere]">{question.doubtNote}</dd></div>}
          </dl>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end"><RowActions label={`「${question.questionText}」のその他の操作`} primary={<button type="button" disabled={busy} onClick={() => onEdit(question)} className="btn-s">設問を編集</button>}>
          <button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} className="btn-s">上へ移動</button>
          <button type="button" disabled={busy || index === ordered.length - 1} onClick={() => move(index, 1)} className="btn-s">下へ移動</button>
          <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); setDialog({ kind: 'active', question, opener: event.currentTarget }); }} className="btn-s">設問を{question.isActive ? '無効' : '有効'}にする</button>
          {question.doubtFlag && <button type="button" disabled={busy} onClick={() => runMutation(() => onClearFlag(question, 'doubtFlag'), '疑義フラグを解除しました')} className="btn-s">疑義フラグを解除</button>}
          {question.explanationRequestFlag && <button type="button" disabled={busy} onClick={() => runMutation(() => onClearFlag(question, 'explanationRequestFlag'), '解説追加フラグを解除しました')} className="btn-s">解説追加フラグを解除</button>}
          <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); setDialog({ kind: 'delete', question, opener: event.currentTarget }); }} className="btn-s border-warn text-warn">設問を削除</button>
        </RowActions></div>
      </li>)}
    </ul>
    {notice?.kind === 'status' && <p role="status" aria-live="polite" className="mt-3 text-[13px] text-ink-soft">{notice.message}</p>}
    {notice?.kind === 'error' && <div role="alert" aria-live="assertive" className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-warn"><span>{notice.message}</span>{retryRef.current && <button type="button" disabled={busy} onClick={() => retryRef.current?.()} className="btn-s border-warn text-warn">再試行</button>}</div>}
    {dialog && <ConfirmDialog title={dialog.kind === 'delete' ? '設問を削除しますか' : `設問を${dialog.question.isActive ? '無効' : '有効'}にしますか`} confirmLabel={dialog.kind === 'delete' ? '削除する' : dialog.question.isActive ? '無効にする' : '有効にする'} destructive={dialog.kind === 'delete'} busy={busy} onCancel={() => { if (!busy) closeDialog(); }} onConfirm={confirmAction}>
      <p className="[overflow-wrap:anywhere]">対象: {dialog.question.questionText}</p>
      {dialog.kind === 'delete' ? <p className="mt-2">この操作は取り消せません。</p> : <p className="mt-2">設問内容と設問IDは保持されます。</p>}
    </ConfirmDialog>}
  </section>;
}
