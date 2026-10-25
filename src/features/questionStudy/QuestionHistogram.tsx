import type { HistogramBin } from './histogram';

/**
 * 1つの分布を、1階級1行の「階級名・横棒・件数」で表示する。
 * 行が縦に並ぶだけなので、階級が多くても狭い画面で横スクロールを起こさない。
 * 件数は常に文字で併記し、色や棒の長さだけに頼らない。
 */
export function QuestionHistogram({ title, bins, total }: {
  title: string;
  bins: readonly HistogramBin[];
  total: number;
}) {
  const max = bins.reduce((value, bin) => Math.max(value, bin.count), 0);
  return (
    <section className="card flex min-w-0 flex-col gap-2 p-3" aria-label={title}>
      <h2 className="text-[16px]">{title}<span className="ml-2 text-[13px] text-muted">全{total}件</span></h2>
      <ul role="list" className="flex flex-col gap-1">
        {bins.map((bin) => (
          <li key={bin.label} aria-label={`${bin.label} ${bin.count}件`}
            className="grid min-w-0 grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-[13px]">
            <span className="min-w-0 break-words">{bin.label}</span>
            <span className="h-4 min-w-0 rounded-sm bg-subtle" aria-hidden="true">
              <span className="block h-full rounded-sm bg-ink-soft"
                style={{ width: max === 0 ? '0%' : `${(bin.count / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{bin.count}件</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
