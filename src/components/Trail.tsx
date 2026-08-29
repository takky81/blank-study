import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type Crumb = { label: string; to?: string };

const TrailContext = createContext<{
  trail: Crumb[];
  setTrail: (trail: Crumb[]) => void;
}>({ trail: [], setTrail: () => {} });

/** ヘッダに出す現在地。画面側から知らせてもらう。 */
export function TrailProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<Crumb[]>([]);
  const value = useMemo(() => ({ trail, setTrail }), [trail]);
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>;
}

/** 画面が自分の現在地を知らせる。中身が同じなら書き換えない。 */
export function useTrail(crumbs: Crumb[]): void {
  const { setTrail } = useContext(TrailContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setTrail(JSON.parse(key) as Crumb[]);
    return () => setTrail([]);
  }, [key, setTrail]);
}

/** ヘッダの現在地表示。最後の1つだけ濃い色にする。 */
export function Trail() {
  const { trail } = useContext(TrailContext);
  if (trail.length === 0) return null;

  return (
    <nav aria-label="現在地" className="flex min-w-0 items-center gap-2 text-[13px] text-ink-soft">
      {trail.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-2">
          <span aria-hidden>／</span>
          {crumb.to === undefined ? (
            <span className={i === trail.length - 1 ? 'truncate text-ink' : 'truncate'}>
              {crumb.label}
            </span>
          ) : (
            <Link to={crumb.to} className="truncate">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
