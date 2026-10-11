import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type {
  MutationResult,
  QuestionContentDraft,
  QuestionFieldError,
  StructuredQuestion,
} from './types';
import { validateQuestionContent } from './validation';

export type QuestionEditorProps = {
  initialDraft: QuestionContentDraft;
  onSave: (draft: QuestionContentDraft) => Promise<MutationResult>;
  onCancel: () => void;
  onReloadConflict: (current: StructuredQuestion) => void;
};

type ChoiceInput = { id: number; value: string };
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; version: number }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; current: StructuredQuestion };

const fieldErrorId = (field: 'questionText' | 'modelAnswer') =>
  `question-editor-${field}-error`;
const choiceErrorId = (index: number) => `question-editor-choice-${index}-error`;

export function QuestionEditor({
  initialDraft,
  onSave,
  onCancel,
  onReloadConflict,
}: QuestionEditorProps) {
  const nextChoiceId = useRef(initialDraft.choices.length);
  const savingRef = useRef(false);
  const pendingChoiceFocus = useRef<number | 'add' | null>(null);
  const addChoiceRef = useRef<HTMLButtonElement>(null);
  const [questionText, setQuestionText] = useState(initialDraft.questionText);
  const [modelAnswer, setModelAnswer] = useState(initialDraft.modelAnswer);
  const [choices, setChoices] = useState<ChoiceInput[]>(() =>
    initialDraft.choices.map((value, id) => ({ id, value })),
  );
  const [explanation, setExplanation] = useState(initialDraft.explanation ?? '');
  const [errors, setErrors] = useState<readonly QuestionFieldError[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  const fieldError = (field: 'questionText' | 'modelAnswer') =>
    errors.find((error) => error.field === field)?.message;
  const choiceError = (index: number) =>
    errors.find((error) => error.field === 'choices' && error.index === index)?.message;

  useLayoutEffect(() => {
    const target = pendingChoiceFocus.current;
    if (target === null) return;
    if (target === 'add') addChoiceRef.current?.focus();
    else document.getElementById(`question-editor-choice-${target}`)?.focus();
    pendingChoiceFocus.current = null;
  }, [choices]);

  function clearFieldError(field: 'questionText' | 'modelAnswer') {
    setErrors((current) => current.filter((error) => error.field !== field));
  }

  function clearChoiceError(index: number) {
    setErrors((current) =>
      current.filter((error) => error.field !== 'choices' || error.index !== index),
    );
  }

  function clearTransientSaveState() {
    setSaveState((current) => (current.kind === 'conflict' ? current : { kind: 'idle' }));
  }

  function changeChoice(id: number, value: string) {
    const index = choices.findIndex((choice) => choice.id === id);
    setChoices((current) =>
      current.map((choice) => (choice.id === id ? { ...choice, value } : choice)),
    );
    if (index >= 0) clearChoiceError(index);
    clearTransientSaveState();
  }

  function addChoice() {
    const id = nextChoiceId.current++;
    pendingChoiceFocus.current = id;
    setChoices((current) => [...current, { id, value: '' }]);
    clearTransientSaveState();
  }

  function removeChoice(id: number) {
    const index = choices.findIndex((choice) => choice.id === id);
    const remaining = choices.filter((choice) => choice.id !== id);
    pendingChoiceFocus.current = remaining[index]?.id ?? remaining[index - 1]?.id ?? 'add';
    setChoices((current) => current.filter((choice) => choice.id !== id));
    setErrors((current) => current.filter((error) => error.field !== 'choices'));
    clearTransientSaveState();
  }

  function moveChoice(index: number, offset: -1 | 1) {
    const movedChoice = choices[index];
    if (movedChoice === undefined) return;
    pendingChoiceFocus.current = movedChoice.id;
    setChoices((current) => {
      const destination = index + offset;
      if (destination < 0 || destination >= current.length) return current;
      const reordered = [...current];
      const [choice] = reordered.splice(index, 1);
      if (choice === undefined) return current;
      reordered.splice(destination, 0, choice);
      return reordered;
    });
    setErrors((current) => current.filter((error) => error.field !== 'choices'));
    clearTransientSaveState();
  }

  async function save() {
    if (savingRef.current || saveState.kind === 'conflict') return;

    const result = validateQuestionContent({
      questionText,
      modelAnswer,
      choices: choices.map((choice) => choice.value),
      explanation,
    });
    if (!result.valid) {
      setErrors(result.errors);
      setSaveState({ kind: 'idle' });
      return;
    }

    setErrors([]);
    setQuestionText(result.draft.questionText);
    setModelAnswer(result.draft.modelAnswer);
    setChoices((current) =>
      current.map((choice, index) => ({ ...choice, value: result.draft.choices[index] ?? '' })),
    );
    setExplanation(result.draft.explanation ?? '');
    savingRef.current = true;
    setSaveState({ kind: 'saving' });
    try {
      const mutation = await onSave(result.draft);
      if (mutation.kind === 'saved') {
        setSaveState({ kind: 'saved', version: mutation.question.version });
      } else {
        setSaveState({ kind: 'conflict', current: mutation.current });
      }
    } catch (caught: unknown) {
      setSaveState({
        kind: 'error',
        message: caught instanceof Error ? caught.message : '設問の保存に失敗しました。',
      });
    } finally {
      savingRef.current = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  const questionTextError = fieldError('questionText');
  const modelAnswerError = fieldError('modelAnswer');
  const saving = saveState.kind === 'saving';

  return (
    <form aria-label="設問編集" className="card flex w-full min-w-0 flex-col gap-5 p-4 sm:p-6" onSubmit={handleSubmit}>
      <div className="flex min-w-0 flex-col gap-1 text-[13px] text-ink-soft">
        <label htmlFor="question-editor-questionText">設問文</label>
        <textarea id="question-editor-questionText" value={questionText} rows={3} disabled={saving} aria-invalid={questionTextError ? true : undefined} aria-describedby={questionTextError ? fieldErrorId('questionText') : undefined} onChange={(event) => { setQuestionText(event.target.value); clearFieldError('questionText'); clearTransientSaveState(); }} className="field h-auto min-w-0 py-2" />
        {questionTextError && <span id={fieldErrorId('questionText')} className="text-warn">{questionTextError}</span>}
      </div>

      <div className="flex min-w-0 flex-col gap-1 text-[13px] text-ink-soft">
        <label htmlFor="question-editor-modelAnswer">模範解答</label>
        <input id="question-editor-modelAnswer" value={modelAnswer} disabled={saving} aria-invalid={modelAnswerError ? true : undefined} aria-describedby={modelAnswerError ? fieldErrorId('modelAnswer') : undefined} onChange={(event) => { setModelAnswer(event.target.value); clearFieldError('modelAnswer'); clearTransientSaveState(); }} className="field min-w-0" />
        {modelAnswerError && <span id={fieldErrorId('modelAnswer')} className="text-warn">{modelAnswerError}</span>}
      </div>

      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-3">
        <legend className="text-[13px] text-ink-soft">選択肢（任意・表示順）</legend>
        {choices.map((choice, index) => {
          const error = choiceError(index);
          return (
            <div key={choice.id} className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`question-editor-choice-${choice.id}`} className="text-[13px] text-ink-soft">選択肢{index + 1}</label>
              <input id={`question-editor-choice-${choice.id}`} value={choice.value} aria-invalid={error ? true : undefined} aria-describedby={error ? choiceErrorId(index) : undefined} onChange={(event) => changeChoice(choice.id, event.target.value)} className="field min-w-0" />
              {error && <span id={choiceErrorId(index)} className="text-[13px] text-warn">{error}</span>}
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-label={`選択肢${index + 1}を上へ移動`} disabled={saving || index === 0} onClick={() => moveChoice(index, -1)} className="btn-s">上へ</button>
                <button type="button" aria-label={`選択肢${index + 1}を下へ移動`} disabled={saving || index === choices.length - 1} onClick={() => moveChoice(index, 1)} className="btn-s">下へ</button>
                <button type="button" aria-label={`選択肢${index + 1}を削除`} disabled={saving} onClick={() => removeChoice(choice.id)} className="btn-s">削除</button>
              </div>
            </div>
          );
        })}
        <button ref={addChoiceRef} type="button" disabled={saving} onClick={addChoice} className="btn-s self-start">選択肢を追加</button>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-1 text-[13px] text-ink-soft">
        <label htmlFor="question-editor-explanation">解説（任意）</label>
        <textarea id="question-editor-explanation" value={explanation} rows={4} disabled={saving} onChange={(event) => { setExplanation(event.target.value); clearTransientSaveState(); }} className="field h-auto min-w-0 py-2" />
      </div>

      {saveState.kind === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-warn">
          <span>{saveState.message}</span>
          <button type="button" onClick={() => void save()} className="btn-s border-warn text-warn">再試行</button>
        </div>
      )}
      {saveState.kind === 'conflict' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-warn">
          <span>保存できませんでした。サーバー上の現在の版は {saveState.current.version} です。編集内容を保持しています。</span>
          <button type="button" onClick={() => onReloadConflict(saveState.current)} className="btn-s border-warn text-warn">
            現在の版 {saveState.current.version} を再読込して確認
          </button>
        </div>
      )}
      {saveState.kind === 'saved' && <p role="status" className="text-[13px] text-ink-soft">保存しました（版 {saveState.version}）</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={saving} onClick={onCancel} className="btn">キャンセル</button>
        <button type="submit" disabled={saving || saveState.kind === 'conflict'} className="btn-p">{saving ? '保存中…' : '保存'}</button>
      </div>
    </form>
  );
}
