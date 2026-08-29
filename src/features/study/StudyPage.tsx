import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTrail } from '@/components/Trail';
import { MarkdownView } from '@/components/MarkdownView';
import { buildTree, flatten, type ChapterRow } from '@/features/chapters/tree';
import { isAnswerable, judge } from '@/lib/answer';
import { loadStudyData, docIdsInBody, recordAnswer, registerAlternative } from './api';
import type { StudyChapter, StudyData, StudyKeyword } from './api';
import { pickNext, type Candidate } from './order';
import { buildChoices, decideFormat, type AnswerFormat, type FormatSetting } from './question';
import { canExpandRange, expandRange, viewOfBlank, type BlankColor } from './range';
import { addAlternative, canRegisterAlt } from './alt';

type Phase = 'setup' | 'answering' | 'judged' | 'done';

const COLOR_CLASS: Record<BlankColor, string> = {
  yellow: 'border-blank-edge bg-blank text-ink',
  gray: 'border-mask-edge bg-mask text-ink-soft',
  orange: 'border-wrong-edge bg-wrong text-ink',
  none: 'border-transparent bg-transparent px-0',
};

/** 章の祖先をたどる。表示範囲を広げるのに使う。 */
function ancestorsOf(chapters: readonly ChapterRow[], chapterId: string): string[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const chain: string[] = [];
  let current = byId.get(chapterId)?.parentId ?? null;
  while (current !== null) {
    chain.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return chain;
}

/**
 * 出題設定と解答の画面。
 * 決定表「出題順」「解答形式の決定」「選択肢の生成」
 * 「表示範囲内のキーワードの表示」「正誤判定」「別解の登録」に対応する。
 */
export function StudyPage() {
  const params = useParams();
  const navigate = useNavigate();
  const scope = params.subjectId
    ? ({ kind: 'subject', id: params.subjectId } as const)
    : ({ kind: 'material', id: params.materialId ?? '' } as const);

  const [data, setData] = useState<StudyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [phase, setPhase] = useState<Phase>('setup');
  const [order, setOrder] = useState<'auto' | 'sequential'>('auto');
  const [formatSetting, setFormatSetting] = useState<FormatSetting>('auto');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [choice, setChoice] = useState('');
  const [correct, setCorrect] = useState(false);
  const [level, setLevel] = useState(0);
  const [expandedUsed, setExpandedUsed] = useState(false);
  const [answered, setAnswered] = useState<string[]>([]);
  /** この回で正解できたキーワード。正解したものは一周から外す（決定表「出題順」列12） */
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [correctCount, setCorrectCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [elapsed, setElapsed] = useState(0);
  /** 記録の途中で画面を離れると解答が消えるので、離脱前に待つ（決定表「出題順」列13） */
  const recording = useRef<Promise<unknown>>(Promise.resolve());
  const [isRecording, setRecording] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await loadStudyData(scope));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [scope.kind, scope.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const backTo = scope.kind === 'subject' ? `/subjects/${scope.id}` : '/';
  useTrail(
    data === null
      ? []
      : [{ label: data.title, to: backTo }, { label: phase === 'setup' ? '出題設定' : '解答中' }],
  );

  const chapters = data?.chapters ?? [];
  const keywords = data?.keywords ?? [];

  /** 本文の出現順に並べた、出題できるキーワード（決定表「出題順」列7・列8）。 */
  const candidates = useMemo(() => {
    const byDocId = new Map<string, StudyKeyword>();
    for (const k of keywords) {
      if (k.isActive) byDocId.set(`${k.materialId}:${k.docId}`, k);
    }

    const ordered: {
      keyword: StudyKeyword;
      chapter: StudyChapter;
      position: number;
    }[] = [];
    let position = 0;
    // 章の順序 → 章内の出現順
    for (const material of [...new Set(chapters.map((c) => c.materialId))]) {
      const rows = chapters.filter((c) => c.materialId === material);
      for (const node of flatten(buildTree(rows))) {
        const chapter = rows.find((c) => c.id === node.id);
        if (!chapter) continue;
        if (excluded.has(chapter.id)) continue;
        const seen = new Set<string>();
        for (const docId of docIdsInBody(chapter.body)) {
          if (seen.has(docId)) continue;
          seen.add(docId);
          const keyword = byDocId.get(`${material}:${docId}`);
          if (!keyword) continue;
          if (ordered.some((o) => o.keyword.id === keyword.id)) continue;
          ordered.push({ keyword, chapter, position: position++ });
        }
      }
    }
    return ordered;
  }, [chapters, keywords, excluded]);

  const current = candidates.find((c) => c.keyword.id === currentId) ?? null;

  /** 表示範囲。既定は出題中のキーワードを含む章（列8）。 */
  const rangeChapters = useMemo(() => {
    if (!current) return [] as StudyChapter[];
    const chain = ancestorsOf(chapters, current.chapter.id);
    if (level === 0) return [current.chapter];
    const rootId = chain[Math.min(level, chain.length) - 1];
    if (level > chain.length || rootId === undefined) {
      return chapters.filter((c) => c.materialId === current.chapter.materialId);
    }
    const within = (id: string): boolean =>
      id === rootId || ancestorsOf(chapters, id).includes(rootId);
    return chapters.filter((c) => c.materialId === current.chapter.materialId && within(c.id));
  }, [chapters, current, level]);

  const maxLevel = current ? ancestorsOf(chapters, current.chapter.id).length + 1 : 0;

  /** 表示範囲の中のキーワード。伏せ字と誤答選択肢の材料になる。 */
  const rangeKeywords = useMemo(() => {
    const map = new Map<string, { answers: string[]; tags: string[] }>();
    for (const chapter of rangeChapters) {
      for (const docId of docIdsInBody(chapter.body)) {
        const keyword = keywords.find(
          (k) => k.docId === docId && k.materialId === chapter.materialId,
        );
        if (keyword) map.set(docId, { answers: keyword.answers, tags: keyword.tags });
      }
    }
    return map;
  }, [rangeChapters, keywords]);

  /** 誤答の候補。章が近いものから使う（決定表「選択肢の生成」列2・列3）。 */
  const choiceSources = useMemo(() => {
    if (!current) return [];
    const chain = [current.chapter.id, ...ancestorsOf(chapters, current.chapter.id)];
    const distanceOf = (chapterId: string | null): number => {
      if (chapterId === null) return chain.length + 1;
      if (chapterId === current.chapter.id) return 0;
      const ancestors = [chapterId, ...ancestorsOf(chapters, chapterId)];
      const shared = ancestors.findIndex((id) => chain.includes(id));
      return shared < 0 ? chain.length + 1 : shared + 1;
    };
    return keywords
      .filter((k) => k.materialId === current.keyword.materialId)
      .map((k) => ({
        keywordId: k.id,
        answers: k.answers,
        tags: k.tags,
        distance: distanceOf(k.chapterId),
        isActive: k.isActive,
      }));
  }, [chapters, keywords, current]);

  const built = useMemo(() => {
    if (!current) return null;
    return buildChoices(
      {
        keywordId: current.keyword.id,
        answers: current.keyword.answers,
        tags: current.keyword.tags,
        wrongChoices: current.keyword.wrongChoices,
      },
      choiceSources,
    );
    // 出題ごとに1回だけ組み立てる。並びが解答中に変わらないようにする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, choiceSources.length]);

  const format: AnswerFormat = current
    ? decideFormat(formatSetting, {
        totalCount: current.keyword.stats?.totalCount ?? 0,
        correctCount: current.keyword.stats?.correctCount ?? 0,
        wrongCount: built?.choices.length ? built.choices.length - 1 : 0,
      })
    : 'text';

  /** 次の1問を出す（決定表「出題順」）。 */
  const advance = useCallback(() => {
    const list: Candidate[] = candidates
      .filter((c) => !solved.has(c.keyword.id))
      .map((c) => ({
        keywordId: c.keyword.id,
        position: c.position,
        dueAt: c.keyword.stats?.dueAt ?? null,
      }));
    const picked = pickNext(list, { order, recent: answered, now: new Date() });
    if (!picked) {
      setPhase('done');
      return;
    }
    setCurrentId(picked.keywordId);
    setPhase('answering');
    setInput('');
    setChoice('');
    setLevel(0);
    setExpandedUsed(false);
  }, [candidates, order, answered, solved]);

  function begin() {
    setAnswered([]);
    setSolved(new Set());
    setCorrectCount(0);
    setTotal(0);
    setStartedAt(Date.now());
    advance();
  }

  const answerValue = format === 'choice' ? choice : input;

  async function submit() {
    if (!current || !isAnswerable(answerValue)) return;
    const isCorrect = judge(answerValue, current.keyword.answers);
    setCorrect(isCorrect);
    setRecording(true);
    setTotal((n) => n + 1);
    if (isCorrect) {
      setCorrectCount((n) => n + 1);
      setSolved((prev) => new Set(prev).add(current.keyword.id));
    }
    setAnswered((list) => [...list, current.keyword.id]);
    setElapsed(Date.now() - startedAt);

    try {
      const request = recordAnswer({
        keywordId: current.keyword.id,
        format,
        input: answerValue,
        correct: isCorrect,
        expanded: expandedUsed,
        stats: current.keyword.stats,
      });
      recording.current = request;
      const next = await request;
      updateLocalStats(current.keyword.id, isCorrect, next.dueAt);
    } catch (e) {
      // 判定はそのまま見せ、記録できなかったことだけ知らせる（決定表「正誤判定」列16）
      setError(e instanceof Error ? e.message : '解答を記録できませんでした');
    } finally {
      // 記録し終えてから判定を見せる。途中で画面を離れても解答が残る（列13・列15）
      setRecording(false);
      setPhase('judged');
    }
  }

  function updateLocalStats(keywordId: string, isCorrect: boolean, dueAt: Date) {
    setData((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            keywords: prev.keywords.map((k) =>
              k.id !== keywordId
                ? k
                : {
                    ...k,
                    stats: {
                      totalCount: (k.stats?.totalCount ?? 0) + 1,
                      correctCount: (k.stats?.correctCount ?? 0) + (isCorrect ? 1 : 0),
                      repetition: k.stats?.repetition ?? 0,
                      interval: k.stats?.interval ?? 0,
                      easeFactor: k.stats?.easeFactor ?? 2.5,
                      dueAt,
                    },
                  },
            ),
          },
    );
  }

  /** 別解として登録し、その回だけ正解に覆す（決定表「別解の登録」列1・列4）。 */
  async function registerAlt() {
    if (!current) return;
    const answers = addAlternative(current.keyword.answers, input);
    try {
      await registerAlternative({
        keywordId: current.keyword.id,
        answers,
        stats: current.keyword.stats,
      });
      setCorrect(true);
      setCorrectCount((n) => n + 1);
      setSolved((prev) => new Set(prev).add(current.keyword.id));
      setError('');
      setData((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              keywords: prev.keywords.map((k) =>
                k.id === current.keyword.id ? { ...k, answers } : k,
              ),
            },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '別解の登録に失敗しました');
    }
  }

  async function stop() {
    // 記録の途中なら書き終わるまで待つ（決定表「出題順」列13）
    await recording.current.catch(() => undefined);
    if (scope.kind === 'subject') navigate(`/subjects/${scope.id}`);
    else navigate(`/subjects/${data?.subjectId ?? ''}`);
  }

  if (loading) return <p className="p-10 text-[13px] text-muted">読み込んでいます…</p>;

  const canStart = candidates.length > 0;

  if (phase === 'setup') {
    const tree = [...new Set(chapters.map((c) => c.materialId))].flatMap((materialId) =>
      flatten(buildTree(chapters.filter((c) => c.materialId === materialId))),
    );

    const untouched = candidates.filter((c) => (c.keyword.stats?.totalCount ?? 0) === 0).length;

    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:px-10 sm:py-7">
        <h1 className="text-[22px]">{data?.title} の出題設定</h1>

        {error !== '' && (
          <div
            role="alert"
            className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn"
          >
            {error}
          </div>
        )}

        <div className="flex flex-col gap-5 lg:flex-row">
          <section className="card flex grow flex-col lg:basis-0">
            <div className="pane-hd">
              <span className="grow">出題範囲</span>
              <button
                type="button"
                onClick={() => setExcluded(new Set())}
                className="btn-s h-8 px-3 text-[12px]"
              >
                すべて選択
              </button>
              <button
                type="button"
                onClick={() => setExcluded(new Set(tree.map((node) => node.id)))}
                className="btn-s h-8 px-3 text-[12px]"
              >
                すべて解除
              </button>
            </div>
            <ul className="flex flex-col p-3">
              {tree.map((node) => {
                const count = candidates.filter((c) => c.chapter.id === node.id).length;
                return (
                  <li key={node.id} style={{ paddingLeft: `${node.depth * 22}px` }}>
                    <div className="flex h-11 items-center gap-3 rounded px-2 text-[14px]">
                      <label className="flex grow items-center gap-3">
                        <input
                          type="checkbox"
                          checked={!excluded.has(node.id)}
                          onChange={(e) =>
                            setExcluded((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(node.id);
                              else next.add(node.id);
                              return next;
                            })
                          }
                          className="h-4.5 w-4.5 accent-ink"
                        />
                        {node.title}
                      </label>
                      <span className="text-[13px] text-muted">{count} 問</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="flex grow flex-col gap-5 lg:basis-0">
            <section className="card flex flex-col">
              <div className="pane-hd">出題順</div>
              <div className="flex flex-col p-3">
                {(
                  [
                    ['auto', '自動', '復習期限が近い順'],
                    ['sequential', '出現順', '章と本文の並び順'],
                  ] as const
                ).map(([value, label, note]) => (
                  <div
                    key={value}
                    className="flex h-11 items-center gap-3 rounded px-2 text-[14px]"
                  >
                    <label className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="order"
                        checked={order === value}
                        onChange={() => setOrder(value)}
                        className="h-4.5 w-4.5 accent-ink"
                      />
                      {label}
                    </label>
                    <span className="text-[13px] text-muted">{note}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="card flex flex-col">
              <div className="pane-hd">解答形式</div>
              <div className="flex flex-col p-3">
                {(
                  [
                    ['auto', '自動', '定着した問題は記述'],
                    ['choice', '選択肢', ''],
                    ['text', '記述', ''],
                  ] as const
                ).map(([value, label, note]) => (
                  <div
                    key={value}
                    className="flex h-11 items-center gap-3 rounded px-2 text-[14px]"
                  >
                    <label className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="format"
                        checked={formatSetting === value}
                        onChange={() => setFormatSetting(value)}
                        className="h-4.5 w-4.5 accent-ink"
                      />
                      {label}
                    </label>
                    {note !== '' && <span className="text-[13px] text-muted">{note}</span>}
                  </div>
                ))}
              </div>
            </section>

            <section className="card flex flex-wrap items-center gap-4 p-4">
              <div className="flex grow flex-col gap-1">
                <span className="text-[15px]">対象 {candidates.length} 問</span>
                <span className="text-[13px] text-muted">
                  {canStart ? `うち未出題 ${untouched} 問` : '出題できるキーワードがありません'}
                </span>
              </div>
              <button
                type="button"
                onClick={begin}
                disabled={!canStart}
                className="btn-p h-12 px-8"
              >
                開始する
              </button>
            </section>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done' || !current) {
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-16">
        <h1 className="text-[22px]">おつかれさまでした</h1>
        <div className="card flex w-full flex-col items-center gap-2 p-8">
          <span className="text-[13px] text-muted">この回の成績</span>
          <span className="text-[28px]">
            正答 {correctCount} / {total}
          </span>
          <span className="text-[13px] text-muted">
            所要時間 {minutes} 分 {seconds} 秒
          </span>
        </div>
        <button type="button" onClick={() => void stop()} className="btn">
          一覧へ戻る
        </button>
      </div>
    );
  }

  const viewContext = {
    phase: phase === 'judged' ? ('judged' as const) : ('answering' as const),
    currentDocId: current.keyword.docId,
    keywords: rangeKeywords,
    correct,
    input: answerValue,
  };

  const solvedCount = solved.size;
  const progress = candidates.length === 0 ? 0 : (solvedCount / candidates.length) * 100;
  const rangeLabel =
    level === 0 ? `章「${current.chapter.title}」` : `章「${current.chapter.title}」＋ 上位の章`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:px-10 sm:py-6">
      {/* 進み具合と中断（ワイヤーフレーム Main / StudyResult のヘッダ帯） */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-[15px]">{data?.title}</h1>
        <span className="grow" />
        <span className="flex items-center gap-2">
          <span className="h-2 w-44 overflow-hidden rounded-full border-[1.5px] border-ink bg-panel">
            <span className="block h-full bg-ink" style={{ width: `${progress}%` }} />
          </span>
          <span className="text-[13px] text-ink-soft">
            {solvedCount} / {candidates.length}
          </span>
        </span>
        <button type="button" onClick={() => void stop()} className="btn-s">
          中断する
        </button>
      </div>

      {error !== '' && (
        <div
          role="alert"
          className="rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn"
        >
          {error}
        </div>
      )}

      {/* 判定の帯（ワイヤーフレーム StudyResult） */}
      {phase === 'judged' && (
        <div
          className={
            correct
              ? 'flex flex-wrap items-center gap-4 rounded-md border-2 border-ink bg-subtle px-5 py-3'
              : 'flex flex-wrap items-center gap-4 rounded-md border-2 border-warn bg-warn-panel px-5 py-3'
          }
        >
          <span
            className={
              correct
                ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-[17px]'
                : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-warn text-[17px] text-warn'
            }
            aria-hidden
          >
            {correct ? '○' : '×'}
          </span>
          <span className={correct ? 'text-[17px]' : 'text-[17px] text-warn'}>
            {correct ? '正解' : '不正解'}
          </span>
          <span className="text-[13px] text-muted">
            {format === 'choice' ? '選択肢形式' : '記述形式'} ・ この問題は出題{' '}
            {(current.keyword.stats?.totalCount ?? 0) + (phase === 'judged' ? 0 : 1)} 回
          </span>
          <span className="grow" />
          {!correct && (
            <>
              <span className="flex items-baseline gap-2">
                <span className="text-[13px] text-muted">あなたの解答</span>
                <span className="text-[16px] text-warn">{answerValue}</span>
              </span>
              <span className="h-6 w-px bg-warn/40" />
            </>
          )}
          <span className="flex items-baseline gap-2">
            <span className="text-[13px] text-muted">正答</span>
            <span className="text-[16px]">{current.keyword.answers.join('、')}</span>
          </span>
        </div>
      )}

      {/* 本文。上に表示範囲の帯、下に色の凡例を置く */}
      <div className="card flex flex-col">
        <div className="pane-hd">
          <span className="grow">表示範囲：{rangeLabel}</span>
          <button
            type="button"
            onClick={() => {
              if (!canExpandRange(level, maxLevel)) return;
              setLevel(expandRange(level, maxLevel));
              setExpandedUsed(true);
            }}
            disabled={!canExpandRange(level, maxLevel)}
            className="btn-s h-8 px-3 text-[12px]"
          >
            表示範囲を広げる
          </button>
        </div>

        <div data-testid="study-body" className="flex flex-col gap-4 px-7 py-6 text-[17px]">
          {rangeChapters.map((chapter) => (
            <MarkdownView
              key={chapter.id}
              body={chapter.body}
              testId={`chapter-body-${chapter.id}`}
              empty=""
              renderBlank={(blank) => {
                const docId = blank.docId ?? '';
                const view = viewOfBlank(docId, viewContext);
                const label =
                  view.display === 'input'
                    ? format === 'choice'
                      ? '選択'
                      : '　　　　'
                    : view.text;
                return (
                  <span
                    data-testid={`blank-${docId}`}
                    data-color={view.color}
                    className={`mx-0.5 inline-flex h-8.5 min-w-24 items-center justify-center rounded border-2 px-3 align-middle text-[15px] ${COLOR_CLASS[view.color]}`}
                  >
                    {label}
                  </span>
                );
              }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-5 border-t-[1.5px] border-line px-4 py-3">
          <Legend className="border-blank-edge bg-blank" label="今回の問題" />
          {phase === 'judged' && !correct && (
            <Legend className="border-wrong-edge bg-wrong" label="あなたが答えた語が入る位置" />
          )}
          <Legend
            className="border-mask-edge bg-mask"
            label={phase === 'judged' ? '解答中は伏せていた語' : '同じタグのため伏せた語'}
          />
        </div>
      </div>

      {phase === 'answering' ? (
        <div className="flex flex-col gap-3">
          {format === 'choice' ? (
            <>
              <p className="text-[13px] text-muted">選択肢から選ぶ</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {built?.choices.map((value, i) => (
                  <li key={value}>
                    <label
                      className={
                        choice === value
                          ? 'relative flex min-h-13 items-center gap-3 rounded-md border-2 border-ink bg-subtle px-4 text-[16px]'
                          : 'relative flex min-h-13 items-center gap-3 rounded-md border-2 border-ink bg-panel px-4 text-[16px]'
                      }
                    >
                      {/* 見た目は番号付きの札。選択の状態は札の側で示す */}
                      <input
                        type="radio"
                        name="choice"
                        checked={choice === value}
                        onChange={() => setChoice(value)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <span
                        aria-hidden
                        className={
                          choice === value
                            ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink bg-ink text-[12px] text-paper'
                            : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-edge text-[12px] text-ink-soft'
                        }
                      >
                        {i + 1}
                      </span>
                      {value}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <input
              aria-label="解答"
              value={input}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              className="field h-13 text-[17px]"
            />
          )}
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-muted">
              {format === 'choice' ? '数字キーでも選べる' : 'Enter でも解答できる'}
            </span>
            <span className="grow" />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!isAnswerable(answerValue) || isRecording}
              className="btn-p h-12 px-8"
            >
              {isRecording ? '記録しています…' : '解答する'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          {canRegisterAlt({ correct, format, input }) && (
            <>
              <button type="button" onClick={() => void registerAlt()} className="btn">
                「{input}」を別解として登録する
              </button>
              <span className="max-w-60 text-[13px] leading-relaxed text-muted">
                登録するとこの回の判定も正解に変わる
              </span>
            </>
          )}
          <span className="grow" />
          <button type="button" onClick={advance} className="btn-p h-12 px-8">
            次の問題へ
          </button>
        </div>
      )}
    </div>
  );
}

/** 色の凡例。ワイヤーフレームの脚注に合わせる。 */
function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`h-3.5 w-3.5 rounded-[3px] border-[1.5px] ${className}`} />
      <span className="text-[13px] text-muted">{label}</span>
    </span>
  );
}
