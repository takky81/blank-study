import { useRef, useState } from 'react';

import { flagMutationContract } from '@/features/questions/api';
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
  | { kind: 'saved' }
  | { kind: 'failed' }
  | { kind: 'conflict' };

const FLAG_LABELS: Record<FlagName, string> = {
  doubtFlag: '内容に疑義がある',
  explanationRequestFlag: '解説の追加を希望する',
};

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
  const locked = status.kind === 'saving' || status.kind === 'conflict';

  const displayed = (flag: FlagName) =>
    status.kind === 'saving' && status.flag === flag ? status.value : question[flag];

  const toggle = async (flag: FlagName, value: boolean) => {
    if (busy.current || locked) return;
    busy.current = true;
    setStatus({ kind: 'saving', flag, value });
    try {
      const result = await setFlags(question.id, question.version, { [flag]: value });
      if (result.kind === 'saved') {
        setQuestion(result.question);
        onQuestionUpdated(result.question);
        setStatus({ kind: 'saved' });
      } else {
        setStatus({ kind: 'conflict' });
      }
    } catch {
      setStatus({ kind: 'failed' });
    } finally {
      busy.current = false;
    }
  };

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
          {status.kind === 'saving' ? '保存しています…' : status.kind === 'saved' ? 'フラグを保存しました' : ''}
        </p>
        {status.kind === 'failed' && (
          <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">
            フラグを保存できませんでした。もう一度お試しください
          </p>
        )}
        {status.kind === 'conflict' && (
          <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">
            設問が別の操作で更新されました。再読み込みしてから設定してください
          </p>
        )}
      </fieldset>
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
    </div>
  );
}
