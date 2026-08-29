import type { ReactNode } from 'react';
import { parseMarkdown, type Blank, type Block, type Inline } from '@/lib/markdown';

/**
 * 本文の描画。編集画面のプレビューと解答画面の本文で使い回す。
 * 空欄の見せ方だけが画面ごとに違うので、その部分を渡してもらう。
 * 文字には本文中の位置を持たせ、選択範囲を本文に対応づけられるようにする。
 */
export function MarkdownView({
  body,
  renderBlank,
  hidden = false,
  testId = 'preview',
  empty = '本文がまだありません。',
}: {
  body: string;
  renderBlank: (blank: Blank) => ReactNode;
  hidden?: boolean;
  testId?: string;
  empty?: string;
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
            <code key={i} className="rounded bg-subtle px-1 ">
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
        case 'blank':
          return <span key={i}>{renderBlank(node)}</span>;
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
            className="my-2 border-l-4 border-line pl-3 whitespace-pre-wrap text-ink-soft"
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
      case 'table':
        return (
          <div key={i} className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {node.head.map((cell, j) => (
                    <th key={j} className="border-2 border-ink bg-subtle px-3 py-2 text-left ">
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k} className="border-2 border-ink px-3 py-2">
                        {inline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'code':
        return (
          <pre key={i} className="my-2 overflow-x-auto rounded bg-subtle p-3 text-[13px] ">
            {node.text}
          </pre>
        );
    }
  };

  return (
    <div
      data-testid={testId}
      hidden={hidden}
      className="grow overflow-y-auto bg-panel px-5 py-4 text-[14px] leading-[2.1]"
    >
      {body.trim() === '' ? <p className="text-[13px] text-muted">{empty}</p> : blocks.map(block)}
    </div>
  );
}
