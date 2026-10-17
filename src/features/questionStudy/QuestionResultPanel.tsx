import { useRef, useState } from 'react';

import { flagMutationContract } from '@/features/questions/api';
import { DOUBT_REASONS, normalizeDoubtReasons, type DoubtReason } from '@/features/questions/doubtReasons';
import type {
  FlagMutationContract,
  StructuredQuestionConsumerView,
} from '@/features/questions/types';

export type QuestionFlagSetter = FlagMutationContract['setQuestionFlags'];

/** 結果表示に必要な設問の内容。版と2種類のflagはサーバー確定値。 */
export type ResultQuestion = Readonly<{
  id: string;
  questionText: string;
  modelAnswer: string;
  explanation: string | null;
  doubtFlag: boolean;
  /** 疑義の内容（任意）。疑義flagがfalseのときは常にnull。 */
  doubtNote: string | null;
  /** 疑義の理由コード（正規順）。疑義flagがfalseのときは常に空。 */
  doubtReasons: readonly DoubtReason[];
  explanationRequestFlag: boolean;
  version: number;
}>;

export type QuestionResultPanelProps = {
  question: ResultQuestion;
  answer: string;
  isCorrect: boolean;
  onNext: () => void;
  onFinish: () => void;
  /** flag更新が保存されたときの最新設問（新しい版）。 */
  onQuestionUpdated: (question: StructuredQuestionConsumerView) => void;
  setFlags?: QuestionFlagSetter;
  /** 回答が未記録のとき。警告と明示再試行を出し、次問へは進ませない。 */
  unrecorded?: { message: string | null; retrying: boolean; onRetry: () => void };
};

type FlagName = 'doubtFlag' | 'explanationRequestFlag';
type FlagStatus =
  | { kind: 'idle' }
  | { kind: 'saving'; flag: FlagName; value: boolean }
  | { kind: 'saving-note' }
  | { kind: 'saved'; target: 'flag' | 'note' }
  | { kind: 'failed'; target: 'flag' | 'note' }
  | { kind: 'conflict' };

const FLAG_LABELS: Record<FlagName, string> = {
  explanationRequestFlag: '解説の追加を希望する',
  doubtFlag: '内容に疑義がある',
};

/** 疑義を付けたときに初期選択しておく理由。 */
const DEFAULT_DOUBT_REASONS: readonly DoubtReason[] = ['answer_guessable'];

export function QuestionResultPanel({
  question: initialQuestion,
  answer,
  isCorrect,
  onNext,
  onFinish,
  onQuestionUpdated,
  setFlags = flagMutationContract.setQuestionFlags,
  unrecorded,
}: QuestionResultPanelProps) {
  // flag保存で得た最新版をここで保持し、続くflag更新に使う。
  const [question, setQuestion] = useState<ResultQuestion>(initialQuestion);
  const [status, setStatus] = useState<FlagStatus>({ kind: 'idle' });
  const busy = useRef(false);
  const [noteDraft, setNoteDraft] = useState(initialQuestion.doubtNote ?? '');
  const [reasonsDraft, setReasonsDraft] = useState<readonly DoubtReason[]>(initialQuestion.doubtReasons);
  // 疑義の内容の自動保存中も入力は続けられるようにし、flag保存中と競合時だけ操作を止める。
  const locked = status.kind === 'saving' || status.kind === 'conflict';

  const displayed = (flag: FlagName) =>
    status.kind === 'saving' && status.flag === flag ? status.value : question[flag];

  const toggle = async (flag: FlagName, value: boolean) => {
    if (busy.current || locked) return;
    busy.current = true;
    setStatus({ kind: 'saving', flag, value });
    try {
      const patch = flag === 'doubtFlag' && value
        ? { doubtFlag: true, doubtReasons: DEFAULT_DOUBT_REASONS }
        : { [flag]: value };
      const result = await setFlags(question.id, question.version, patch);
      if (result.kind === 'saved') {
        latest.current = result.question;
        setQuestion(result.question);
        if (flag === 'doubtFlag') {
          setNoteDraft(result.question.doubtNote ?? '');
          setReasonsDraft(result.question.doubtReasons);
        }
        onQuestionUpdated(result.question);
        setStatus({ kind: 'saved', target: 'flag' });
      } else {
        setStatus({ kind: 'conflict' });
      }
    } catch {
      setStatus({ kind: 'failed', target: 'flag' });
    } finally {
      busy.current = false;
    }
  };

  // 疑義の理由と内容は、理由のチェックごと・内容の入力欄からフォーカスが外れたときに自動保存する。
  // 版付き契約で直列に送り、保存中に来た変更は最新の1件だけを続けて送る。失敗時は入力を保持する。
  const latest = useRef<ResultQuestion>(initialQuestion);
  const pending = useRef<{ reasons: readonly DoubtReason[]; note: string } | null>(null);
  const saveNote = async (reasons: readonly DoubtReason[], note: string) => {
    if (locked || !latest.current.doubtFlag) return;
    if (busy.current) {
      pending.current = { reasons, note };
      return;
    }
    busy.current = true;
    let next: { reasons: readonly DoubtReason[]; note: string } | null = { reasons, note };
    try {
      while (next) {
        const target = next;
        pending.current = null;
        setStatus({ kind: 'saving-note' });
        const doubtNote = target.note.trim() === '' ? null : target.note.trim();
        const result = await setFlags(latest.current.id, latest.current.version, {
          doubtFlag: true, doubtReasons: normalizeDoubtReasons(target.reasons), doubtNote,
        });
        if (result.kind !== 'saved') {
          setStatus({ kind: 'conflict' });
          return;
        }
        latest.current = result.question;
        setQuestion(result.question);
        onQuestionUpdated(result.question);
        next = pending.current;
      }
      setStatus({ kind: 'saved', target: 'note' });
    } catch {
      setStatus({ kind: 'failed', target: 'note' });
    } finally {
      busy.current = false;
    }
  };

  const noteChanged = () => (noteDraft.trim() === '' ? null : noteDraft.trim()) !== (latest.current.doubtNote ?? null);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h1 className="text-[18px] whitespace-pre-wrap break-words">{question.questionText}</h1>
      <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-2 text-[14px]">
        <p className={`flex items-center gap-3 rounded-md border-2 px-4 py-2 text-[18px] ${isCorrect
          ? 'border-correct bg-correct-panel text-correct' : 'border-incorrect bg-incorrect-panel text-incorrect'}`}>
          <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[17px] ${isCorrect
            ? 'border-correct' : 'border-incorrect'}`}>{isCorrect ? '○' : '×'}</span>
          <span>{isCorrect ? '正解' : '不正解'}</span>
        </p>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted">あなたの解答</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words">{answer === '' ? 'わからない' : answer}</dd>
          <dt className="text-muted">模範解答</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words">{question.modelAnswer}</dd>
        </dl>
      </div>
      {question.explanation && (
        <section aria-labelledby="question-result-explanation" className="min-w-0 text-[14px]">
          <h2 id="question-result-explanation" className="text-[15px]">解説</h2>
          <p className="whitespace-pre-wrap break-words">{question.explanation}</p>
        </section>
      )}
      {unrecorded && unrecorded.message !== null && !unrecorded.retrying && (
        <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">
          この回答は未記録です。{unrecorded.message}。記録してから次の問題へ進めます
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {unrecorded ? (
          <button type="button" className="btn-p h-12 px-8" onClick={unrecorded.onRetry} disabled={unrecorded.retrying}>
            {unrecorded.retrying ? '記録しています…' : '記録を再試行'}
          </button>
        ) : (
          <button type="button" className="btn-p h-12 px-8" onClick={onNext}>次の問題へ</button>
        )}
        <button type="button" className="btn-s h-11 px-4" onClick={onFinish}
          disabled={unrecorded?.retrying ?? false}>学習を終える</button>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-1 rounded border p-3">
        <legend className="px-1 text-[14px]">見直しフラグ</legend>
        {(Object.keys(FLAG_LABELS) as FlagName[]).map((flag) => (
          <label key={flag} className="flex min-h-11 items-center gap-3 px-1 text-[14px]">
            <input type="checkbox" className="h-4.5 w-4.5 shrink-0 accent-ink"
              checked={displayed(flag)} disabled={locked}
              onChange={(event) => { void toggle(flag, event.target.checked); }} />
            {FLAG_LABELS[flag]}
          </label>
        ))}
        <p aria-live="polite" className="text-[13px] text-muted">
          {status.kind === 'saving' || status.kind === 'saving-note' ? '保存しています…'
            : status.kind === 'saved' ? (status.target === 'note' ? '疑義の理由・内容を保存しました' : 'フラグを保存しました') : ''}
        </p>
        {question.doubtFlag && status.kind !== 'saving' && (
          <div className="flex min-w-0 flex-col gap-2 px-1">
            <fieldset className="flex min-w-0 flex-col">
              <legend className="text-[14px]">疑義の理由</legend>
              {DOUBT_REASONS.map(({ code, label }) => (
                <label key={code} className="flex min-h-11 min-w-0 items-center gap-3 text-[14px]">
                  <input type="checkbox" className="h-4.5 w-4.5 shrink-0 accent-ink"
                    checked={reasonsDraft.includes(code)} disabled={locked}
                    onChange={(event) => {
                      const reasons = normalizeDoubtReasons(event.target.checked
                        ? [...reasonsDraft, code] : reasonsDraft.filter((c) => c !== code));
                      setReasonsDraft(reasons);
                      void saveNote(reasons, noteDraft);
                    }} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                </label>
              ))}
            </fieldset>
            <label htmlFor="question-result-doubt-note" className="text-[14px]">疑義の内容（任意）</label>
            <textarea id="question-result-doubt-note" rows={3} maxLength={1000}
              className="min-h-11 w-full min-w-0 rounded border px-3 py-2 text-[14px]"
              value={noteDraft} disabled={locked}
              onChange={(event) => setNoteDraft(event.target.value)}
              onBlur={() => { if (noteChanged()) void saveNote(reasonsDraft, noteDraft); }} />
            <p className="text-[12px] text-muted">理由はチェックするたびに、内容は入力欄から離れたときに保存します</p>
          </div>
        )}
        {status.kind === 'failed' && (
          <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">
            {status.target === 'note' ? '疑義の理由・内容' : 'フラグ'}を保存できませんでした。もう一度お試しください
            {status.target === 'note' && (
              <button type="button" className="btn-s ml-3 h-11 border-warn px-4 text-warn"
                onClick={() => { void saveNote(reasonsDraft, noteDraft); }}>再保存</button>
            )}
          </p>
        )}
        {status.kind === 'conflict' && (
          <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">
            設問が別の操作で更新されました。再読み込みしてから設定してください
          </p>
        )}
      </fieldset>
    </div>
  );
}
