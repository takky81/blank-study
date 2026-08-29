import { useCallback, useEffect, useMemo, useState } from 'react';
import { aggregate, classify, dailyVolume, weakKeywords, type StatRow } from './aggregate';
import { loadHistory, type HistoryData, type HistoryNode } from './api';

/** 日別の学習量を見せる日数。 */
const DAYS = 14;

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * 学習履歴画面。決定表「学習履歴の集計」に対応する。
 * 科目 → 教材 → 章 の階層で達成度を見せ、苦手キーワードと日別の学習量を並べる。
 */
export function HistoryPage() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = await loadHistory();
      setData(loaded);
      // 科目は開いた状態で始める。教材から下は押して開く（列17）
      setOpen(new Set(loaded.tree.map((node) => node.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = useMemo(() => new Date(), []);
  const rowsOf = useCallback(
    (ids: readonly string[]): StatRow[] =>
      ids.map((id) => data?.rows.get(id)).filter((r): r is StatRow => r !== undefined),
    [data],
  );

  if (loading) return <p className="p-10 text-sm text-stone-500">読み込んでいます…</p>;

  const allRows = [...(data?.rows.values() ?? [])];
  const weak = weakKeywords(allRows).slice(0, 10);
  const days = dailyVolume(data?.logs ?? [], now, DAYS);
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const hasLogs = (data?.logs.length ?? 0) > 0;

  const renderNode = (node: HistoryNode, depth: number): React.ReactNode => {
    const summary = aggregate(rowsOf(node.keywordIds), now);
    const expanded = open.has(node.id);
    const bar = [
      { label: '定着', value: summary.settled, className: 'bg-emerald-600' },
      { label: '苦手', value: summary.weak, className: 'bg-orange-500' },
      { label: '未出題', value: summary.untouched, className: 'bg-stone-300' },
    ];

    return (
      <li key={node.id} data-testid={`history-row-${node.title}`}>
        <button
          type="button"
          onClick={() =>
            setOpen((prev) => {
              const next = new Set(prev);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            })
          }
          disabled={node.children.length === 0}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          className="flex w-full flex-col gap-2 rounded border-2 border-stone-900 bg-white p-3 text-left disabled:cursor-default dark:border-stone-100 dark:bg-stone-900"
        >
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              {node.children.length > 0 ? (expanded ? '▼' : '▶') : '・'} {node.title}
            </span>
            <span className="grow" />
            <span className="text-xs text-stone-500">{summary.total} 問</span>
            <span className="text-xs text-stone-500">正答率 {percent(summary.correctRate)}</span>
            <span className="text-xs text-stone-500">今日 {summary.dueToday} 件</span>
          </span>
          <span className="flex h-3 w-full overflow-hidden rounded bg-stone-200">
            {bar.map((part) => (
              <span
                key={part.label}
                className={part.className}
                style={{
                  width: summary.total === 0 ? '0%' : `${(part.value / summary.total) * 100}%`,
                }}
              />
            ))}
          </span>
          <span className="flex gap-3 text-xs text-stone-500">
            {bar.map((part) => (
              <span key={part.label}>
                {part.label} {part.value}
              </span>
            ))}
          </span>
        </button>

        {expanded && node.children.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-10">
      <h1 className="text-2xl">学習履歴</h1>

      {error !== '' && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded border-2 border-orange-700 bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-950/40"
        >
          <span className="grow">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="h-11 rounded border border-orange-700 px-3"
          >
            再試行
          </button>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">達成度</h2>
        {data?.tree.length === 0 ? (
          <p className="text-sm text-stone-400">まだ科目がありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">{data?.tree.map((node) => renderNode(node, 0))}</ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">苦手なキーワード</h2>
        {weak.length === 0 ? (
          <p className="text-sm text-stone-400">解答したキーワードがまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {weak.map((row) => (
              <li
                key={row.keywordId}
                data-testid="weak-keyword"
                className="flex items-center gap-3 rounded border-2 border-stone-900 bg-white p-3 text-sm dark:border-stone-100 dark:bg-stone-900"
              >
                <span className="grow">{row.answers[0]}</span>
                <span className="text-xs text-stone-500">
                  {row.correctCount} / {row.totalCount} 正答
                </span>
                <span className="text-xs text-stone-500">
                  {percent(row.correctCount / row.totalCount)}
                </span>
                <span className="rounded border border-stone-400 px-2 py-0.5 text-xs">
                  {classify(row) === 'settled' ? '定着' : '苦手'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">日別の学習量</h2>
        {hasLogs ? (
          <ul data-testid="daily-volume" className="flex items-end gap-1">
            {days.map((day) => (
              <li
                key={day.date}
                data-testid="daily-cell"
                data-count={day.count}
                title={`${day.date} ${day.count} 問 正答率 ${percent(day.correctRate)}`}
                className="flex grow flex-col items-center gap-1"
              >
                <span
                  className="w-full rounded-t bg-stone-900 dark:bg-stone-100"
                  style={{ height: `${8 + (day.count / maxCount) * 60}px` }}
                />
                <span className="text-[10px] text-stone-500">{day.date.slice(5)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-400">まだ解答の記録がありません</p>
        )}
      </section>
    </div>
  );
}
