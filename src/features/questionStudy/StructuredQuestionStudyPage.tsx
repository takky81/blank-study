import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { createSubmitGuard } from '@/lib/submitGuard';
import { useNarrow } from '@/lib/useNarrow';
import {
  loadQuestionStudyCandidates,
  questionScopeOptionsLoader,
  recordQuestionAnswer,
  type QuestionScopeOption,
  type QuestionScopeOptionsLoader,
  type RecordQuestionAnswerInput,
  type RecordQuestionAnswerResult,
} from './api';
import { listQuestionsByKeyword } from '@/features/questions/api';
import type { StructuredQuestion, StructuredQuestionConsumerView } from '@/features/questions/types';
import { QuestionResultPanel, type QuestionFlagSetter } from './QuestionResultPanel';
import type { QuestionStudyCandidate, QuestionStudyScope } from './candidates';
import {
  buildQuestionChoiceOptions,
  canSubmitWrittenAnswer,
  judgeQuestionAnswer,
  judgeQuestionChoice,
  resolveQuestionMode,
  type RequestedQuestionMode,
  type ResolvedQuestionMode,
} from './question';
import {
  finishQuestionSession,
  pickNextQuestion,
  recordQuestionSessionAnswer,
  startQuestionSession,
  type QuestionSession,
  type QuestionStudyOrder,
} from './session';

export type StructuredQuestionStudyPageProps = {
  initialScope: QuestionStudyScope | null;
  onExit: () => void;
  loadCandidates?: (scope: QuestionStudyScope) => Promise<readonly QuestionStudyCandidate[]>;
  recordAnswer?: (input: RecordQuestionAnswerInput) => Promise<RecordQuestionAnswerResult>;
  scopeOptions?: QuestionScopeOptionsLoader;
  setFlags?: QuestionFlagSetter;
  /** 設問version競合時に現在設問の最新版を読み直す。出題できなくなったら null。 */
  reloadQuestion?: (question: StructuredQuestion) => Promise<StructuredQuestion | null>;
  now?: () => Date;
};

/** 公開の設問readから同じ設問の最新版を探す。無効・削除済みなら null。 */
async function reloadQuestionFromApi(question: StructuredQuestion): Promise<StructuredQuestion | null> {
  const list = await listQuestionsByKeyword(question.keywordId);
  const found = list.find((q) => q.id === question.id);
  return found && found.isActive ? found : null;
}

/** 出題できなくなった設問をsessionから外す。記録済み件数は変えない。 */
function dropQuestion(session: QuestionSession, questionId: string): QuestionSession {
  const candidates = session.candidates.filter((c) => c.question.id !== questionId);
  const total = candidates.length;
  const completed = session.result.answered >= total;
  return {
    ...session,
    candidates,
    result: { ...session.result, total, completed, ended: session.result.ended || completed },
  };
}

type ChoiceItem = { value: string; unknown: boolean };

type Current = {
  candidate: QuestionStudyCandidate;
  mode: ResolvedQuestionMode;
  choices: readonly ChoiceItem[];
};

/** 判定済み回答の記録状態。failed の間は次問へ進めず、明示再試行だけを受け付ける。 */
export type RecordStatus =
  | { kind: 'recording' }
  | { kind: 'recorded' }
  | { kind: 'failed'; message: string };

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'setup'; candidates: readonly QuestionStudyCandidate[] }
  | { kind: 'answering'; session: QuestionSession; current: Current; busy: boolean; notice: string | null }
  | {
    kind: 'judged';
    session: QuestionSession;
    current: Current;
    /** 再試行で同じ内容を送り直すための記録入力（設問version・回答・形式を含む）。 */
    input: RecordQuestionAnswerInput;
    isCorrect: boolean;
    record: RecordStatus;
  }
  | { kind: 'done'; session: QuestionSession };

const ORDER_OPTIONS: readonly { value: QuestionStudyOrder; label: string }[] = [
  { value: 'auto', label: 'おまかせ' },
  { value: 'sequential', label: '順番どおり' },
];
const MODE_OPTIONS: readonly { value: RequestedQuestionMode; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'choice', label: '選択式' },
  { value: 'written', label: '記述式' },
];

function prepare(candidate: QuestionStudyCandidate, requested: RequestedQuestionMode): Current {
  const built = buildQuestionChoiceOptions(candidate.question.modelAnswer, candidate.question.choices);
  const mode = resolveQuestionMode(requested, candidate.stats, built.distractors);
  const choices = mode === 'choice'
    // 登録順のまま（模範解答→重複しない登録選択肢）、「わからない」は末尾に分けて置く。
    ? [...built.options.map((o) => ({ value: o.value, unknown: false })), { value: built.unknown.label, unknown: true }]
    : [];
  return { candidate, mode, choices };
}

export function StructuredQuestionStudyPage({
  initialScope,
  onExit,
  loadCandidates = loadQuestionStudyCandidates,
  recordAnswer = recordQuestionAnswer,
  scopeOptions = questionScopeOptionsLoader,
  setFlags,
  reloadQuestion = reloadQuestionFromApi,
  now = () => new Date(),
}: StructuredQuestionStudyPageProps) {
  const narrow = useNarrow();
  const [scope, setScope] = useState<QuestionStudyScope | null>(initialScope);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [order, setOrder] = useState<QuestionStudyOrder>('auto');
  const [requestedMode, setRequestedMode] = useState<RequestedQuestionMode>('auto');
  const [written, setWritten] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const guard = useMemo(() => createSubmitGuard(), []);

  useEffect(() => {
    if (!scope) return;
    let active = true;
    setView({ kind: 'loading' });
    loadCandidates(scope).then(
      (candidates) => {
        if (active) setView(candidates.length === 0 ? { kind: 'empty' } : { kind: 'setup', candidates });
      },
      () => { if (active) setView({ kind: 'error', message: '設問を読み込めませんでした' }); },
    );
    return () => { active = false; };
  }, [scope, loadCandidates, loadAttempt]);

  const advance = (session: QuestionSession, notice: string | null = null) => {
    const next = pickNextQuestion(session, now());
    setWritten('');
    setSelected(null);
    if (!next) {
      setView({ kind: 'done', session: session.result.ended ? session : finishQuestionSession(session) });
      return;
    }
    setView({ kind: 'answering', session, current: prepare(next, requestedMode), busy: false, notice });
  };

  const begin = (candidates: readonly QuestionStudyCandidate[]) => advance(startQuestionSession(candidates, order));

  const submit = (session: QuestionSession, current: Current) => {
    const { question } = current.candidate;
    let answer: string;
    let isCorrect: boolean;
    if (current.mode === 'choice') {
      const choice = selected === null ? undefined : current.choices[selected];
      if (!choice) return;
      answer = choice.unknown ? '' : choice.value;
      isCorrect = judgeQuestionChoice(choice, question.modelAnswer);
    } else {
      if (!canSubmitWrittenAnswer(written)) return;
      answer = written;
      isCorrect = judgeQuestionAnswer(written, question.modelAnswer);
    }
    const input: RecordQuestionAnswerInput = {
      questionId: question.id,
      expectedQuestionVersion: question.version,
      answer,
      mode: current.mode,
      answeredAt: now().toISOString(),
    };
    void guard.run(async () => {
      setView({ kind: 'answering', session, current, busy: true, notice: null });
      await sendRecord(session, current, input, isCorrect);
    });
  };

  /** 記録を送り、結果に応じて画面を確定する。成功時だけsessionへ1回分を反映する。 */
  const sendRecord = async (
    session: QuestionSession, current: Current, input: RecordQuestionAnswerInput, isCorrect: boolean,
  ) => {
    let result: RecordQuestionAnswerResult;
    try {
      result = await recordAnswer(input);
    } catch {
      result = { kind: 'failed', message: '回答を記録できませんでした' };
    }
    // 途中終了した後に届いた応答で画面を戻さない。
    const ended = (prev: View) => prev.kind === 'done';
    if (result.kind === 'recorded') {
      const { stats } = result;
      setView((prev) => ended(prev) ? prev : {
        kind: 'judged',
        session: recordQuestionSessionAnswer(session, input.questionId, isCorrect, stats),
        current, input, isCorrect, record: { kind: 'recorded' },
      });
      return;
    }
    if (result.kind === 'failed') {
      const message = result.message;
      setView((prev) => ended(prev) ? prev : {
        kind: 'judged', session, current, input, isCorrect, record: { kind: 'failed', message },
      });
      return;
    }
    // 設問version競合: 古い判定は記録せず捨て、最新版を読み直して再回答させる。
    setView((prev) => ended(prev) ? prev : { kind: 'answering', session, current, busy: true, notice: null });
    let latest: StructuredQuestion | null;
    try {
      latest = await reloadQuestion(current.candidate.question);
    } catch {
      setView((prev) => ended(prev) ? prev : {
        kind: 'answering', session, current, busy: false,
        notice: '設問が更新されましたが、再読み込みできませんでした。もう一度解答してください',
      });
      return;
    }
    setWritten('');
    setSelected(null);
    if (!latest || !latest.isActive) {
      advance(dropQuestion(session, input.questionId), '設問が出題できなくなったため、記録せずに飛ばしました');
      return;
    }
    const candidate = { ...current.candidate, question: latest };
    const updated: QuestionSession = {
      ...session,
      candidates: session.candidates.map((c) => (c.question.id === candidate.question.id ? candidate : c)),
    };
    setView((prev) => ended(prev) ? prev : {
      kind: 'answering', session: updated, current: prepare(candidate, requestedMode), busy: false,
      notice: '設問が更新されました。最新の内容でもう一度解答してください',
    });
  };

  /** 未記録の判定を同じ入力のまま送り直す。 */
  const retry = (session: QuestionSession, current: Current, input: RecordQuestionAnswerInput, isCorrect: boolean) => {
    void guard.run(async () => {
      setView({ kind: 'judged', session, current, input, isCorrect, record: { kind: 'recording' } });
      await sendRecord(session, current, input, isCorrect);
    });
  };

  /** flag保存後の最新版を判定済み表示へ反映する。記録済み回答は旧版のまま。 */
  const updateJudgedQuestion = (updated: StructuredQuestionConsumerView) => {
    setView((prev) => {
      if (prev.kind !== 'judged' || prev.current.candidate.question.id !== updated.id) return prev;
      const candidate = { ...prev.current.candidate, question: { ...prev.current.candidate.question, ...updated } };
      return { ...prev, current: { ...prev.current, candidate } };
    });
  };

  const finish = (session: QuestionSession) => setView({ kind: 'done', session: finishQuestionSession(session) });

  const shell = (children: ReactNode) => (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 p-4 break-words sm:px-10 sm:py-7">
      {children}
    </div>
  );
  const backButton = <button type="button" className="btn-s h-11 px-4" onClick={onExit}>戻る</button>;

  if (!scope) {
    return shell(<ScopePicker loader={scopeOptions} onSelect={setScope} onExit={onExit} />);
  }
  if (view.kind === 'loading') return <p className="p-10 text-[13px] text-muted">読み込んでいます…</p>;
  if (view.kind === 'error') {
    return shell(<>
      <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">{view.message}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-p h-12 px-8" onClick={() => setLoadAttempt((n) => n + 1)}>再読み込み</button>
        {backButton}
      </div>
    </>);
  }
  if (view.kind === 'empty') {
    return shell(<>
      <p className="text-[14px]">
        この範囲に出題できる設問はありません
      </p>
      <div>{backButton}</div>
    </>);
  }
  if (view.kind === 'setup') {
    const radioGroup = <T extends string>(
      title: string, name: string, options: readonly { value: T; label: string }[], value: T, set: (v: T) => void,
    ) => (
      <fieldset className="card flex flex-col p-3">
        <legend className="px-1 text-[14px]">{title}</legend>
        <div role="radiogroup" aria-label={title} className="flex flex-wrap gap-x-4">
          {options.map((option) => (
            <label key={option.value} className="flex h-11 items-center gap-3 px-2 text-[14px]">
              <input type="radio" name={name} className="h-4.5 w-4.5 accent-ink"
                checked={value === option.value} onChange={() => set(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
    return shell(<>
      <h1 className="text-[22px]">設問学習の設定</h1>
      <p className="text-[14px]">対象 {view.candidates.length} 問</p>
      {radioGroup('出題順', 'question-order', ORDER_OPTIONS, order, setOrder)}
      {radioGroup('解答形式', 'question-mode', MODE_OPTIONS, requestedMode, setRequestedMode)}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-p h-12 px-8" onClick={() => begin(view.candidates)}>学習を開始</button>
        {backButton}
      </div>
    </>);
  }
  if (view.kind === 'done') {
    const { result } = view.session;
    return shell(<>
      <h1 className="text-[22px]">{result.completed ? '学習が終わりました' : '学習を途中で終えました'}</h1>
      <p className="text-[15px]">正解 {result.correct} / {result.answered} 問</p>
      <div>{backButton}</div>
    </>);
  }

  const { session, current } = view;
  const { question } = current.candidate;
  const recording = view.kind === 'answering' && view.busy;
  const canSubmit = !recording && (current.mode === 'choice' ? selected !== null : canSubmitWrittenAnswer(written));
  const progress = (
    <p className="text-[13px] text-muted" aria-label="進行状況">
      {session.result.answered} / {session.result.total} 問
    </p>
  );

  return shell(<>
    <div className="flex flex-wrap items-center justify-between gap-3">
      {progress}
      {view.kind === 'answering' && (
        <button type="button" className="btn-s h-11 px-4" onClick={() => finish(session)} disabled={recording}>
          学習を終える
        </button>
      )}
    </div>
    <section className="card flex min-w-0 flex-col gap-4 p-4">
      {view.kind === 'answering' && (
        <h1 className="text-[18px] whitespace-pre-wrap break-words">{question.questionText}</h1>
      )}
      {view.kind === 'answering' ? (
        <form className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => { event.preventDefault(); if (canSubmit) submit(session, current); }}>
          {current.mode === 'choice' ? (
            <div role="radiogroup" aria-label="選択肢" className={`grid gap-2 ${narrow ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {current.choices.map((choice, index) => (
                <label key={`${index}-${choice.value}`}
                  className="flex min-h-11 min-w-0 items-center gap-3 rounded border px-3 py-2 text-[14px]">
                  <input type="radio" name="question-choice" className="h-4.5 w-4.5 shrink-0 accent-ink"
                    checked={selected === index} disabled={recording} onChange={() => setSelected(index)} />
                  <span className="min-w-0 break-words">{choice.value}</span>
                </label>
              ))}
            </div>
          ) : (
            <label className="flex min-w-0 flex-col gap-2 text-[14px]">
              解答
              <input type="text" className="h-11 w-full min-w-0 rounded border px-3"
                value={written} disabled={recording} onChange={(event) => setWritten(event.target.value)} />
            </label>
          )}
          {view.notice && (
            <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">
              {view.notice}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn-p h-12 px-8" disabled={!canSubmit}>
              {recording ? '記録しています…' : '解答する'}
            </button>
          </div>
        </form>
      ) : (
        <QuestionResultPanel key={question.id} question={question} answer={view.input.answer} isCorrect={view.isCorrect}
          unrecorded={view.record.kind === 'recorded' ? undefined : {
            message: view.record.kind === 'failed' ? view.record.message : null,
            retrying: view.record.kind === 'recording',
            onRetry: () => retry(session, current, view.input, view.isCorrect),
          }}
          onNext={() => advance(session)} onFinish={() => finish(session)} setFlags={setFlags}
          onQuestionUpdated={(updated) => updateJudgedQuestion(updated)} />
      )}
    </section>
  </>);
}

type Level = 'subject' | 'material' | 'chapter' | 'keyword';

/** 科目→教材→章／キーワードの順に絞る範囲選択。選んだ最も深い階層を範囲にする。 */
function ScopePicker({ loader, onSelect, onExit }: {
  loader: QuestionScopeOptionsLoader;
  onSelect: (scope: QuestionStudyScope) => void;
  onExit: () => void;
}) {
  const [options, setOptions] = useState<Record<Level, readonly QuestionScopeOption[] | null>>({
    subject: null, material: null, chapter: null, keyword: null,
  });
  const [picked, setPicked] = useState<Record<Level, string>>({ subject: '', material: '', chapter: '', keyword: '' });
  const [error, setError] = useState<string | null>(null);

  const load = (level: Level, promise: Promise<readonly QuestionScopeOption[]>) => {
    promise.then(
      (list) => setOptions((prev) => ({ ...prev, [level]: list })),
      () => setError('出題範囲の候補を読み込めませんでした'),
    );
  };

  useEffect(() => {
    let active = true;
    loader.listSubjects().then(
      (list) => { if (active) setOptions((prev) => ({ ...prev, subject: list })); },
      () => { if (active) setError('出題範囲の候補を読み込めませんでした'); },
    );
    return () => { active = false; };
  }, [loader]);

  const choose = (level: Level, id: string) => {
    setError(null);
    if (level === 'subject') {
      setPicked({ subject: id, material: '', chapter: '', keyword: '' });
      setOptions((prev) => ({ ...prev, material: null, chapter: null, keyword: null }));
      if (id) load('material', loader.listMaterials(id));
    } else if (level === 'material') {
      setPicked((prev) => ({ ...prev, material: id, chapter: '', keyword: '' }));
      setOptions((prev) => ({ ...prev, chapter: null, keyword: null }));
      if (id) {
        load('chapter', loader.listChapters(id));
        load('keyword', loader.listKeywords(id));
      }
    } else if (level === 'chapter') {
      setPicked((prev) => ({ ...prev, chapter: id, keyword: '' }));
    } else {
      setPicked((prev) => ({ ...prev, keyword: id, chapter: '' }));
    }
  };

  const scope: QuestionStudyScope | null = picked.keyword ? { kind: 'keyword', id: picked.keyword }
    : picked.chapter ? { kind: 'chapter', id: picked.chapter }
      : picked.material ? { kind: 'material', id: picked.material }
        : picked.subject ? { kind: 'subject', id: picked.subject } : null;

  const select = (level: Level, label: string, placeholder: string) => {
    const list = options[level];
    if (list === null) return null;
    return (
      <label className="flex min-w-0 flex-col gap-2 text-[14px]">
        {label}
        <select className="h-11 w-full min-w-0 rounded border px-2" value={picked[level]}
          onChange={(event) => choose(level, event.target.value)}>
          <option value="">{placeholder}</option>
          {list.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
    );
  };

  return (
    <>
      <h1 className="text-[22px]">出題範囲を選んでください</h1>
      {error && <p role="alert" className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn">{error}</p>}
      {options.subject === null && !error && <p className="text-[13px] text-muted">読み込んでいます…</p>}
      {select('subject', '科目', '科目を選ぶ')}
      {select('material', '教材', '教材全体')}
      {select('chapter', '章', '章を指定しない')}
      {select('keyword', 'キーワード', 'キーワードを指定しない')}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-p h-12 px-8" disabled={!scope}
          onClick={() => { if (scope) onSelect(scope); }}>この範囲で設定する</button>
        <button type="button" className="btn-s h-11 px-4" onClick={onExit}>戻る</button>
      </div>
    </>
  );
}
