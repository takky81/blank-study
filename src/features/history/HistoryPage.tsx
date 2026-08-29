import { useCallback, useEffect, useMemo, useState } from 'react';
import { aggregate, classify, dailyVolume, weakKeywords, type StatRow } from './aggregate';
import { useTrail } from '@/components/Trail';
import { loadHistory, type HistoryData, type HistoryNode } from './api';

/** 日別の学習量を見せる日数。 */
const DAYS = 14;

/** 帯の色の凡例。薄い側から並べる。 */
const LEGEND = [
  { label: '未出題', className: 'bg-untouched' },
  { label: '苦手', className: 'bg-wrong' },
  { label: '定着', className: 'bg-ink' },
] as const;

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

  useTrail([{ label: '学習履歴' }]);

  const now = useMemo(() => new Date(), []);
  const rowsOf = useCallback(
    (ids: readonly string[]): StatRow[] =>
      ids.map((id) => data?.rows.get(id)).filter((r): r is StatRow => r !== undefined),
    [data],
  );

  if (loading) return <p className="p-10 text-[13px] text-muted">読み込んでいます…</p>;

  const allRows = [...(data?.rows.values() ?? [])];
  const weak = weakKeywords(allRows).slice(0, 10);
  const days = dailyVolume(data?.logs ?? [], now, DAYS);
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const hasLogs = (data?.logs.length ?? 0) > 0;
  const total = aggregate(allRows, now);

  const renderNode = (node: HistoryNode, depth: number): React.ReactNode => {
    const summary = aggregate(rowsOf(node.keywordIds), now);
    const expanded = open.has(node.id);
    const bar = [
      { label: '定着', value: summary.settled, className: 'bg-ink' },
      { label: '苦手', value: summary.weak, className: 'bg-wrong' },
      { label: '未出題', value: summary.untouched, className: 'bg-untouched' },
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
          style={{ paddingLeft: `${18 + depth * 18}px` }}
          className="flex w-full flex-wrap items-center gap-3 py-2 pr-4 text-left text-[14px] disabled:cursor-default"
        >
          <span aria-hidden className="w-4 shrink-0 text-[12px] text-muted">
            {node.children.length > 0 ? (expanded ? '▾' : '▸') : ''}
          </span>
          <span className="min-w-32 grow truncate">{node.title}</span>
          <span
            className="flex h-3 w-33 shrink-0 overflow-hidden rounded-[3px] border-[1.5px] border-ink bg-untouched"
            title={bar.map((part) => `${part.label} ${part.value}`).join(' ・ ')}
          >
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
          <span className="w-40 shrink-0 text-[12px] text-muted">
            {bar.map((part) => `${part.label} ${part.value}`).join(' ・ ')}
          </span>
          <span className="w-16 shrink-0 text-right text-[13px] text-ink-soft">
            {summary.total} 問
          </span>
          <span className="w-12 shrink-0 text-right text-[13px] text-ink-soft">
            {percent(summary.correctRate)}
          </span>
          <span className="w-16 shrink-0 text-right text-[13px] text-ink-soft">
            今日 {summary.dueToday}
          </span>
        </button>

        {expanded && node.children.length > 0 && (
          <ul className="flex flex-col">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6 sm:px-10 sm:py-8">
      <h1 className="text-[22px]">学習履歴</h1>

      {error !== '' && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn"
        >
          <span className="grow">{error}</span>
          <button type="button" onClick={() => void load()} className="btn-s border-warn text-warn">
            再試行
          </button>
        </div>
      )}

      {/* 復習の残り件数と、帯の色の凡例 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="card flex min-w-40 flex-col gap-1 px-5 py-4">
          <span className="text-[12px] text-muted">今日の復習</span>
          <span className="text-[22px]">{total.dueToday} 問</span>
        </div>
        <div className="card flex min-w-40 flex-col gap-1 px-5 py-4">
          <span className="text-[12px] text-muted">今週の復習</span>
          <span className="text-[22px]">{total.dueThisWeek} 問</span>
        </div>
        <span className="grow" />
        <ul className="flex flex-wrap items-center gap-4 text-[12px] text-muted">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              <span
                className={`h-3 w-3 rounded-[2px] border-[1.5px] border-ink ${item.className}`}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      <section className="card flex flex-col">
        <h2 className="pane-hd">科目 ・ 教材 ・ 章</h2>
        {data?.tree.length === 0 ? (
          <p className="p-6 text-[13px] text-muted">まだ科目がありません。</p>
        ) : (
          <ul className="flex flex-col py-2">{data?.tree.map((node) => renderNode(node, 0))}</ul>
        )}
      </section>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <section className="card flex grow basis-0 flex-col">
          <h2 className="pane-hd">苦手キーワード</h2>
          {weak.length === 0 ? (
            <p className="p-6 text-[13px] text-muted">解答したキーワードがまだありません。</p>
          ) : (
            <ul className="flex flex-col py-2">
              {weak.map((row) => (
                <li
                  key={row.keywordId}
                  data-testid="weak-keyword"
                  className="flex items-center gap-3 px-5 py-2 text-[14px]"
                >
                  <span className="grow truncate">{row.answers[0]}</span>
                  <span className="shrink-0 text-[12px] text-muted">
                    {row.correctCount} / {row.totalCount} 正答
                  </span>
                  <span className="w-12 shrink-0 text-right text-[13px] text-ink-soft">
                    {percent(row.correctCount / row.totalCount)}
                  </span>
                  <span className="shrink-0 rounded border-[1.5px] border-edge px-2 py-0.5 text-[11px] text-ink-soft">
                    {classify(row) === 'settled' ? '定着' : '苦手'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flex grow basis-0 flex-col">
          <h2 className="pane-hd">日別の学習量</h2>
          {hasLogs ? (
            <ul data-testid="daily-volume" className="flex items-end gap-1 px-5 py-4">
              {days.map((day) => (
                <li
                  key={day.date}
                  data-testid="daily-cell"
                  data-count={day.count}
                  title={`${day.date} ${day.count} 問 正答率 ${percent(day.correctRate)}`}
                  className="flex grow flex-col items-center gap-1"
                >
                  <span
                    className="w-full rounded-t-[2px] bg-ink"
                    style={{ height: `${8 + (day.count / maxCount) * 60}px` }}
                  />
                  <span className="text-[10px] text-muted">{day.date.slice(5)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-[13px] text-muted">まだ解答の記録がありません</p>
          )}
        </section>
      </div>
    </div>
  );
}
