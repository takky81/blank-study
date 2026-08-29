import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  yellow: 'border-amber-500 bg-amber-100 text-stone-900',
  gray: 'border-stone-400 bg-stone-200 text-stone-700',
  orange: 'border-orange-600 bg-orange-200 text-stone-900',
  none: 'border-transparent',
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

  const chapters = data?.chapters ?? [];
  const keywords = data?.keywords ?? [];

  /** 本文の出現順に並べた、出題できるキーワード（決定表「出題順」列7・列8）。 */
  const candidates = useMemo(() => {
    const byDocId = new Map<string, StudyKeyword>();
    for (const k of keywords) {
      if (k.isActive) byDocId.set(`${k.materialId}:${k.docId}`, k);
    }

    const ordered: { keyword: StudyKeyword; chapter: StudyChapter; position: number }[] = [];
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
    setPhase('judged');
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

  if (loading) return <p className="p-10 text-sm text-stone-500">読み込んでいます…</p>;

  const canStart = candidates.length > 0;

  if (phase === 'setup') {
    const tree = [...new Set(chapters.map((c) => c.materialId))].flatMap((materialId) =>
      flatten(buildTree(chapters.filter((c) => c.materialId === materialId))),
    );

    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-10">
        <h1 className="text-2xl">{data?.title} の出題設定</h1>

        {error !== '' && (
          <div role="alert" className="rounded border-2 border-orange-700 bg-orange-50 p-3 text-sm">
            {error}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-lg">出題範囲</h2>
          <ul className="flex flex-col gap-1">
            {tree.map((node) => (
              <li key={node.id} style={{ paddingLeft: `${node.depth * 18}px` }}>
                <label className="flex h-9 items-center gap-2 text-sm">
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
                    className="h-5 w-5"
                  />
                  {node.title}
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg">出題順</h2>
          <div className="flex gap-4">
            {(
              [
                ['auto', '自動'],
                ['sequential', '出現順'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="order"
                  checked={order === value}
                  onChange={() => setOrder(value)}
                  className="h-5 w-5"
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg">解答形式</h2>
          <div className="flex gap-4">
            {(
              [
                ['auto', '自動'],
                ['choice', '選択肢'],
                ['text', '記述'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="format"
                  checked={formatSetting === value}
                  onChange={() => setFormatSetting(value)}
                  className="h-5 w-5"
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        {!canStart && (
          <p className="text-sm text-orange-700">出題できるキーワードがありません</p>
        )}

        <button
          type="button"
          onClick={begin}
          disabled={!canStart}
          className="h-12 rounded border-2 border-stone-900 bg-stone-900 px-5 text-stone-50 disabled:opacity-40 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
        >
          開始する
        </button>
      </div>
    );
  }

  if (phase === 'done' || !current) {
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-5 p-10">
        <h1 className="text-2xl">おつかれさまでした</h1>
        <p className="text-lg">
          正答 {correctCount} / {total}
        </p>
        <p className="text-sm text-stone-500">
          所要時間 {minutes} 分 {seconds} 秒
        </p>
        <button
          type="button"
          onClick={() => void stop()}
          className="h-12 rounded border-2 border-stone-900 px-5 dark:border-stone-100"
        >
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg">{data?.title}</h1>
        <span className="text-xs text-stone-500">
          {total} 問／正答 {correctCount}
        </span>
        <span className="grow" />
        <button
          type="button"
          onClick={() => {
            if (!canExpandRange(level, maxLevel)) return;
            setLevel(expandRange(level, maxLevel));
            setExpandedUsed(true);
          }}
          disabled={!canExpandRange(level, maxLevel)}
          className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 disabled:opacity-40 dark:text-stone-300"
        >
          表示範囲を広げる
        </button>
        <button
          type="button"
          onClick={() => void stop()}
          className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
        >
          中断する
        </button>
      </div>

      {error !== '' && (
        <div
          role="alert"
          className="rounded border-2 border-orange-700 bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-950/40"
        >
          {error}
        </div>
      )}

      <div
        data-testid="study-body"
        className="flex flex-col gap-4 rounded-md border-2 border-stone-900 bg-white p-4 dark:border-stone-100 dark:bg-stone-900"
      >
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
                  className={`mx-0.5 inline-flex h-8 items-center rounded border-2 px-3 align-middle text-sm ${COLOR_CLASS[view.color]}`}
                >
                  {label}
                </span>
              );
            }}
          />
        ))}
      </div>

      {phase === 'answering' ? (
        <div className="flex flex-col gap-3">
          {format === 'choice' ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {built?.choices.map((value) => (
                <li key={value}>
                  <label className="flex h-12 items-center gap-2 rounded border-2 border-stone-900 px-3 dark:border-stone-100">
                    <input
                      type="radio"
                      name="choice"
                      checked={choice === value}
                      onChange={() => setChoice(value)}
                      className="h-5 w-5"
                    />
                    {value}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <input
              aria-label="解答"
              value={input}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              className="h-12 rounded border-2 border-stone-900 px-3 dark:border-stone-100 dark:bg-stone-800"
            />
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!isAnswerable(answerValue)}
            className="h-12 rounded border-2 border-stone-900 bg-stone-900 px-5 text-stone-50 disabled:opacity-40 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
          >
            解答する
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className={correct ? 'text-lg text-emerald-700' : 'text-lg text-orange-700'}>
            {correct ? '正解' : '不正解'}
          </p>
          {!correct && (
            <p className="text-sm text-stone-500">
              正答: {current.keyword.answers.join('、')} ／ あなたの解答: {answerValue}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {canRegisterAlt({ correct, format, input }) && (
              <button
                type="button"
                onClick={() => void registerAlt()}
                className="h-12 rounded border-2 border-stone-900 px-4 dark:border-stone-100"
              >
                別解として登録する
              </button>
            )}
            <button
              type="button"
              onClick={advance}
              className="h-12 grow rounded border-2 border-stone-900 bg-stone-900 px-5 text-stone-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
            >
              次の問題へ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
