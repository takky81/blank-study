import type { ReactNode } from 'react';
import { parseMarkdown, type Blank, type Block, type Inline } from '@/lib/markdown';

/**
 * プレビュー。決定表「編集画面の操作」列1・列6・列14 に対応する。
 * 文字には本文中の位置を持たせ、選択範囲を本文に対応づけられるようにする。
 */
export function Preview({
  body,
  answersOf,
  onOpenBlank,
  hidden = false,
}: {
  body: string;
  /** IDのみの記述で正答を出すために、保存済みの内容を引く */
  answersOf: (docId: string) => string[];
  onOpenBlank: (blank: Blank) => void;
  hidden?: boolean;
}) {
  const blocks = parseMarkdown(body);

  const inline = (nodes: Inline[]): ReactNode =>
    nodes.map((node, i) => {
      switch (node.type) {
        case 'text':
          return (
            <span key={i} data-start={node.start}>
              {node.text}
            </span>
          );
        case 'code':
          return (
            <code key={i} className="rounded bg-stone-100 px-1 dark:bg-stone-800">
              {node.text}
            </code>
          );
        case 'strong':
          return <strong key={i}>{inline(node.children)}</strong>;
        case 'em':
          return <em key={i}>{inline(node.children)}</em>;
        case 'link':
          return (
            <a key={i} href={node.href} className="underline" target="_blank" rel="noreferrer">
              {inline(node.children)}
            </a>
          );
        case 'blank': {
          const answers = node.answers.length > 0 ? node.answers : answersOf(node.docId ?? '');
          return (
            <button
              key={i}
              type="button"
              data-testid={node.docId === null ? `blank-new-${node.start}` : `blank-${node.docId}`}
              onClick={() => onOpenBlank(node)}
              className="mx-0.5 inline-flex h-8 items-center rounded border-2 border-amber-500 bg-amber-100 px-3 align-middle text-sm text-stone-900"
            >
              {answers[0] ?? '空欄'}
            </button>
          );
        }
      }
    });

  const block = (node: Block, i: number): ReactNode => {
    switch (node.type) {
      case 'heading': {
        const Tag = `h${Math.min(node.level + 1, 6)}` as 'h2';
        const size = ['text-xl', 'text-lg', 'text-base'][Math.min(node.level - 1, 2)];
        return (
          <Tag key={i} className={`${size} mt-4 mb-2 font-bold first:mt-0`}>
            {inline(node.children)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={i} className="my-2 leading-8 whitespace-pre-wrap">
            {inline(node.children)}
          </p>
        );
      case 'quote':
        return (
          <blockquote
            key={i}
            className="my-2 border-l-4 border-stone-300 pl-3 whitespace-pre-wrap text-stone-600 dark:text-stone-400"
          >
            {inline(node.children)}
          </blockquote>
        );
      case 'list': {
        const Tag = node.ordered ? 'ol' : 'ul';
        return (
          <Tag key={i} className={`my-2 ml-6 ${node.ordered ? 'list-decimal' : 'list-disc'}`}>
            {node.items.map((item, j) => (
              <li key={j} className="leading-8">
                {inline(item)}
              </li>
            ))}
          </Tag>
        );
      }
      case 'code':
        return (
          <pre
            key={i}
            className="my-2 overflow-x-auto rounded bg-stone-100 p-3 text-sm dark:bg-stone-800"
          >
            {node.text}
          </pre>
        );
    }
  };

  return (
    <div
      data-testid="preview"
      hidden={hidden}
      className="grow overflow-y-auto rounded-md border-2 border-stone-900 bg-white p-4 dark:border-stone-100 dark:bg-stone-900"
    >
      {body.trim() === '' ? (
        <p className="text-sm text-stone-400">本文がまだありません。</p>
      ) : (
        blocks.map(block)
      )}
    </div>
  );
}
