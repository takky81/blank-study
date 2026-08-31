import { useRef, type ReactNode, type RefObject } from 'react';
import { scanKeywordTokens, parseKeywordToken } from '@/lib/keyword';

/**
 * 本文の編集領域。決定表「編集画面の操作」列2・列12・列15 に対応する。
 * 透明な textarea の下に同じ字送りの層を敷き、キーワードの記述だけ色を付ける。
 */
export function BodyEditor({
  value,
  onChange,
  onSelect,
  hidden = false,
  scrollRef,
  onScroll,
}: {
  value: string;
  onChange: (next: string) => void;
  onSelect: (start: number, end: number) => void;
  hidden?: boolean;
  /** プレビューと巻き上げ位置を合わせるための参照（列17） */
  scrollRef?: RefObject<HTMLTextAreaElement | null>;
  onScroll?: () => void;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const areaRef = scrollRef ?? ownRef;
  const layerRef = useRef<HTMLDivElement>(null);

  const report = () => {
    const area = areaRef.current;
    if (area) onSelect(area.selectionStart, area.selectionEnd);
  };

  return (
    <div hidden={hidden} className="relative min-h-0 grow overflow-hidden bg-panel">
      <div
        ref={layerRef}
        data-testid="editor-highlight"
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden p-4 font-mono text-[12.5px] leading-[2] whitespace-pre-wrap"
      >
        {highlight(value)}
      </div>
      <textarea
        ref={areaRef}
        aria-label="本文"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onSelect={report}
        onKeyUp={report}
        onMouseUp={report}
        onScroll={(e) => {
          if (layerRef.current) layerRef.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.();
        }}
        className="relative h-full min-h-72 w-full resize-none bg-transparent p-4 font-mono text-[12.5px] leading-[2] text-transparent caret-ink outline-none"
      />
    </div>
  );
}

/** キーワードとして読める記述だけ色を変える（列12）。 */
function highlight(body: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let at = 0;
  let key = 0;

  for (const token of scanKeywordTokens(body)) {
    if (!parseKeywordToken(token.inner)) continue;
    if (token.start > at) nodes.push(<span key={key++}>{body.slice(at, token.start)}</span>);
    nodes.push(
      <span
        key={key++}
        className="kw bg-kw pb-px"
        style={{ borderBottom: '2px solid var(--c-blank-edge)' }}
      >
        {body.slice(token.start, token.end)}
      </span>,
    );
    at = token.end;
  }

  // 末尾に改行があるとき、最後の行も高さを持つようにする
  nodes.push(<span key={key++}>{`${body.slice(at)}\n`}</span>);
  return nodes;
}
