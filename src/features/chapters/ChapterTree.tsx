import { buildTree, type ChapterNode, type ChapterRow } from './tree';

/**
 * 章ツリー。決定表「章の管理」列7・列8・列9 のドラッグに対応する。
 * 章の上に落とすと子にし、章と章のあいだの隙間に落とすと並べ替える。
 */
export function ChapterTree({
  rows,
  selectedId,
  onSelect,
  onDropOnChapter,
  onDropInGap,
  onDragStartChapter,
}: {
  rows: readonly ChapterRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDropOnChapter: (targetId: string) => void;
  onDropInGap: (parentId: string | null, index: number) => void;
  onDragStartChapter: (id: string) => void;
}) {
  const renderLevel = (nodes: readonly ChapterNode[], parentId: string | null) => (
    <>
      {nodes.map((node, index) => (
        <li key={node.id} className="list-none">
          <Gap parentId={parentId} index={index} onDropInGap={onDropInGap} />
          <div
            role="treeitem"
            aria-level={node.depth + 1}
            aria-selected={node.id === selectedId}
            aria-label={node.title}
            data-testid={`chapter-item-${node.id}`}
            tabIndex={0}
            draggable
            onClick={() => onSelect(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(node.id);
              }
            }}
            onDragStart={() => onDragStartChapter(node.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.stopPropagation();
              onDropOnChapter(node.id);
            }}
            style={{ paddingLeft: `${8 + node.depth * 18}px` }}
            className={
              node.id === selectedId
                ? 'cursor-pointer rounded bg-stone-900 py-2 pr-2 text-sm text-stone-50 dark:bg-stone-100 dark:text-stone-900'
                : 'cursor-pointer rounded py-2 pr-2 text-sm hover:bg-stone-100 dark:hover:bg-stone-800'
            }
          >
            {node.title}
          </div>
          {node.children.length > 0 && (
            <ul role="group">{renderLevel(node.children, node.id)}</ul>
          )}
        </li>
      ))}
      <Gap parentId={parentId} index={nodes.length} onDropInGap={onDropInGap} />
    </>
  );

  return (
    <ul role="tree" aria-label="章" className="flex flex-col">
      {renderLevel(buildTree(rows), null)}
    </ul>
  );
}

function Gap({
  parentId,
  index,
  onDropInGap,
}: {
  parentId: string | null;
  index: number;
  onDropInGap: (parentId: string | null, index: number) => void;
}) {
  return (
    <div
      data-testid={`chapter-gap-${parentId ?? 'root'}-${index}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.stopPropagation();
        onDropInGap(parentId, index);
      }}
      className="h-1.5 rounded transition-colors hover:bg-stone-300"
    />
  );
}
