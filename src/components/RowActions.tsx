import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNarrow } from '@/lib/useNarrow';

/**
 * 一覧の行に並ぶ操作。
 * 狭い画面では主要な操作だけを残し、残りをメニューに畳む
 * （決定表「表示設定と共通の振る舞い」列8）。
 */
export function RowActions({ primary, children }: { primary: ReactNode; children: ReactNode }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!narrow) {
    return (
      <>
        {primary}
        {children}
      </>
    );
  }

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {primary}
      <button
        type="button"
        aria-label="メニュー"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="btn-s w-11 text-lg"
      >
        ⋯
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="absolute top-12 right-0 z-10 flex min-w-40 flex-col gap-2 card p-2"
        >
          {children}
        </div>
      )}
    </div>
  );
}
