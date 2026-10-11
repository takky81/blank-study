import { useCallback, useEffect, useRef, useState } from 'react';

import { deleteQuestion, listQuestionsByKeyword, reorderQuestions, saveQuestion, setQuestionActive, setQuestionFlags } from './api';
import { QuestionEditor } from './QuestionEditor';
import { QuestionList, type QuestionFlagName } from './QuestionList';
import { QuestionBankOperationCancelled } from './operationCancellation';
import type { DeleteQuestionResult, MutationResult, QuestionContentDraft, QuestionDraft, QuestionFlagPatch, QuestionVersionToken, ReorderQuestionResult, StructuredQuestion } from './types';

export type QuestionBankKeywordContext = { id: string; materialId: string; label: string };
export type QuestionBankApi = {
  listQuestionsByKeyword: (keywordId: string) => Promise<StructuredQuestion[]>;
  saveQuestion: (draft: QuestionDraft, id?: string, expectedVersion?: number) => Promise<MutationResult>;
  setQuestionFlags: (id: string, expectedVersion: number, flags: QuestionFlagPatch) => Promise<MutationResult>;
  setQuestionActive: (id: string, expectedVersion: number, active: boolean) => Promise<MutationResult>;
  reorderQuestions: (keywordId: string, ordered: readonly QuestionVersionToken[]) => Promise<ReorderQuestionResult>;
  deleteQuestion: (id: string, expectedVersion: number) => Promise<DeleteQuestionResult>;
};
export type QuestionBankPageProps = { materialId: string; keyword: QuestionBankKeywordContext | null; onBack?: () => void; api?: QuestionBankApi };

const defaultApi: QuestionBankApi = { listQuestionsByKeyword, saveQuestion, setQuestionFlags, setQuestionActive, reorderQuestions, deleteQuestion };
const EMPTY_DRAFT: QuestionContentDraft = { questionText: '', modelAnswer: '', choices: [], explanation: null };
type LoadState = { kind: 'loading' } | { kind: 'empty' } | { kind: 'loaded'; questions: readonly StructuredQuestion[] }
  | { kind: 'error'; message: string } | { kind: 'refresh-error'; message: string; questions: readonly StructuredQuestion[] };
type EditorState = { kind: 'create' } | { kind: 'edit'; question: StructuredQuestion };
type ContextSnapshot = { generation: number; materialId: string; keywordId: string };

export function QuestionBankPage({ materialId, keyword, onBack, api = defaultApi }: QuestionBankPageProps) {
  const validContext = keyword !== null && keyword.materialId === materialId;
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const contextRef = useRef({ materialId, keywordId: validContext ? keyword.id : null });
  contextRef.current = { materialId, keywordId: validContext ? keyword.id : null };
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [conflict, setConflict] = useState<StructuredQuestion | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; generationRef.current += 1; };
  }, []);
  const isCurrent = useCallback((snapshot: ContextSnapshot) => {
    const current = contextRef.current;
    return mountedRef.current && generationRef.current === snapshot.generation
      && current.materialId === snapshot.materialId && current.keywordId === snapshot.keywordId;
  }, []);
  const read = useCallback(async (snapshot: ContextSnapshot, previous?: readonly StructuredQuestion[]) => {
    try {
      const questions = await api.listQuestionsByKeyword(snapshot.keywordId);
      if (!isCurrent(snapshot)) return false;
      setLoadState(questions.length === 0 ? { kind: 'empty' } : { kind: 'loaded', questions });
      return true;
    } catch (caught: unknown) {
      if (!isCurrent(snapshot)) return false;
      const message = caught instanceof Error ? caught.message : '設問の取得に失敗しました。';
      setLoadState(previous === undefined ? { kind: 'error', message } : { kind: 'refresh-error', message, questions: previous });
      return false;
    }
  }, [api, isCurrent]);

  useEffect(() => {
    const generation = ++generationRef.current;
    setEditor(null); setConflict(null);
    if (!validContext || keyword === null) return () => { if (generationRef.current === generation) generationRef.current += 1; };
    const snapshot = { generation, materialId, keywordId: keyword.id };
    setLoadState({ kind: 'loading' }); void read(snapshot);
    return () => { if (generationRef.current === generation) generationRef.current += 1; };
  }, [materialId, keyword?.id, validContext, read]);

  if (!validContext || keyword === null) return <main className="mx-auto flex max-w-4xl flex-col items-start gap-4 p-6 sm:px-10 sm:py-8">
    <h1 className="text-[22px]">設問バンク</h1><p role="status" className="text-[13px] text-muted">対象のキーワードを表示できません。</p>
    {onBack && <button type="button" onClick={onBack} className="btn">一覧へ戻る</button>}
  </main>;

  const context = keyword;
  const visibleQuestions = loadState.kind === 'loaded' || loadState.kind === 'refresh-error' ? loadState.questions : [];
  const capture = (): ContextSnapshot => ({ generation: generationRef.current, materialId: context.materialId, keywordId: context.id });
  const replaceConfirmed = (snapshot: ContextSnapshot, questions: readonly StructuredQuestion[]) => {
    if (isCurrent(snapshot)) setLoadState(questions.length === 0 ? { kind: 'empty' } : { kind: 'loaded', questions });
  };
  const refreshConfirmed = async (snapshot: ContextSnapshot, questions: readonly StructuredQuestion[]) => { if (isCurrent(snapshot)) await read(snapshot, questions); };
  const replaceQuestion = (questions: readonly StructuredQuestion[], saved: StructuredQuestion) => questions.some((item) => item.id === saved.id)
    ? questions.map((item) => item.id === saved.id ? saved : item) : [...questions, saved];
  const inContext = async <T,>(snapshot: ContextSnapshot, request: () => Promise<T>): Promise<T> => {
    try {
      const result = await request();
      if (!isCurrent(snapshot)) throw new QuestionBankOperationCancelled();
      return result;
    } catch (caught: unknown) {
      if (!isCurrent(snapshot)) throw new QuestionBankOperationCancelled();
      throw caught;
    }
  };

  async function save(draft: QuestionContentDraft): Promise<MutationResult> {
    const snapshot = capture(); const target = editor?.kind === 'edit' ? editor.question : undefined;
    const result = await inContext(snapshot, () => api.saveQuestion({ keywordId: snapshot.keywordId, ...draft }, target?.id, target?.version));
    if (result.kind === 'saved' && isCurrent(snapshot)) { const confirmed = replaceQuestion(visibleQuestions, result.question); replaceConfirmed(snapshot, confirmed); setEditor(null); await refreshConfirmed(snapshot, confirmed); }
    return result;
  }
  async function setActive(question: StructuredQuestion, active: boolean): Promise<MutationResult> {
    const snapshot = capture(); const result = await inContext(snapshot, () => api.setQuestionActive(question.id, question.version, active));
    if (result.kind === 'saved' && isCurrent(snapshot)) { const confirmed = replaceQuestion(visibleQuestions, result.question); replaceConfirmed(snapshot, confirmed); await refreshConfirmed(snapshot, confirmed); }
    return result;
  }
  async function clearFlag(question: StructuredQuestion, flag: QuestionFlagName): Promise<MutationResult> {
    const snapshot = capture(); const patch = flag === 'doubtFlag' ? { doubtFlag: false } : { explanationRequestFlag: false };
    const result = await inContext(snapshot, () => api.setQuestionFlags(question.id, question.version, patch));
    if (result.kind === 'saved' && isCurrent(snapshot)) { const confirmed = replaceQuestion(visibleQuestions, result.question); replaceConfirmed(snapshot, confirmed); await refreshConfirmed(snapshot, confirmed); }
    return result;
  }
  async function reorder(ordered: readonly QuestionVersionToken[]): Promise<ReorderQuestionResult> {
    const snapshot = capture(); const result = await inContext(snapshot, () => api.reorderQuestions(snapshot.keywordId, ordered));
    if (!('kind' in result) && isCurrent(snapshot)) { replaceConfirmed(snapshot, result); await refreshConfirmed(snapshot, result); }
    return result;
  }
  async function remove(question: StructuredQuestion): Promise<DeleteQuestionResult> {
    const snapshot = capture(); const result = await inContext(snapshot, () => api.deleteQuestion(question.id, question.version));
    if (result === 'deleted' && isCurrent(snapshot)) { const confirmed = visibleQuestions.filter((item) => item.id !== question.id); replaceConfirmed(snapshot, confirmed); await refreshConfirmed(snapshot, confirmed); }
    return result;
  }

  const retryRead = () => { const snapshot = capture(); setLoadState({ kind: 'loading' }); void read(snapshot); };
  return <main className="mx-auto flex min-w-0 max-w-4xl flex-col gap-5 p-4 sm:px-10 sm:py-8">
    <header className="flex min-w-0 flex-wrap items-center gap-3"><div className="min-w-0 grow"><h1 className="text-[22px]">設問バンク</h1><p className="[overflow-wrap:anywhere] text-[13px] text-ink-soft">キーワード: {context.label}</p></div>{(loadState.kind === 'loaded' || loadState.kind === 'refresh-error') && !editor && <button type="button" onClick={() => setEditor({ kind: 'create' })} className="btn-p">設問を作成</button>}</header>
    {conflict && <div role="alert" className="flex flex-wrap items-center gap-2 rounded border-2 border-warn bg-warn-panel p-3 text-[13px] text-warn"><span>サーバー上の現在の版 {conflict.version} を確認してください。編集中の入力は再読込するまで保持されます。</span><button type="button" onClick={() => { setConflict(null); setEditor(null); retryRead(); }} className="btn-s border-warn text-warn">現在の版を再読込</button></div>}
    {editor && <QuestionEditor key={editor.kind === 'edit' ? `${editor.question.id}:${editor.question.version}` : `create:${context.id}`} initialDraft={editor.kind === 'edit' ? editor.question : EMPTY_DRAFT} onSave={save} onCancel={() => { setEditor(null); setConflict(null); }} onReloadConflict={setConflict} />}
    {!editor && loadState.kind === 'loading' && <p role="status" aria-live="polite" className="rounded border-2 border-line p-6 text-[13px] text-muted">設問を読み込み中…</p>}
    {!editor && loadState.kind === 'error' && <div role="alert" className="flex flex-wrap items-center gap-3 rounded border-2 border-warn bg-warn-panel p-3 text-[13px] text-warn"><span className="grow">{loadState.message}</span><button type="button" onClick={retryRead} className="btn-s border-warn text-warn">再試行</button></div>}
    {!editor && loadState.kind === 'empty' && <section className="flex flex-col items-center gap-4 rounded border-2 border-dashed border-line p-8 text-center"><p className="text-[13px] text-muted">このキーワードには設問がまだありません。</p><button type="button" onClick={() => setEditor({ kind: 'create' })} className="btn-p">最初の設問を作成</button></section>}
    {!editor && loadState.kind === 'refresh-error' && <div role="alert" className="flex flex-wrap items-center gap-3 rounded border-2 border-warn bg-warn-panel p-3 text-[13px] text-warn"><span className="grow">変更は保存されましたが、最新の一覧を取得できませんでした。{loadState.message}</span><button type="button" onClick={() => void read(capture(), loadState.questions)} className="btn-s border-warn text-warn">一覧を再取得</button></div>}
    {!editor && (loadState.kind === 'loaded' || loadState.kind === 'refresh-error') && <QuestionList questions={visibleQuestions} onEdit={(question) => setEditor({ kind: 'edit', question })} onReorder={reorder} onSetActive={setActive} onClearFlag={clearFlag} onDelete={remove} onVersionConflict={setConflict} />}
  </main>;
}
