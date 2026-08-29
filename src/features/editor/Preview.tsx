import { MarkdownView } from '@/components/MarkdownView';
import type { Blank } from '@/lib/markdown';

/**
 * 編集画面のプレビュー。決定表「編集画面の操作」列1・列6・列14 に対応する。
 * 空欄はクリックするとキーワード編集ダイアログを開く。
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
  return (
    <MarkdownView
      body={body}
      hidden={hidden}
      renderBlank={(blank) => {
        const answers = blank.answers.length > 0 ? blank.answers : answersOf(blank.docId ?? '');
        return (
          <button
            type="button"
            data-testid={blank.docId === null ? `blank-new-${blank.start}` : `blank-${blank.docId}`}
            onClick={() => onOpenBlank(blank)}
            className="mx-0.5 inline-flex h-7 min-w-20 items-center justify-center rounded border-2 border-blank-edge bg-blank px-2 align-middle text-[14px] text-ink hover:border-ink"
          >
            {answers[0] ?? '空欄'}
          </button>
        );
      }}
    />
  );
}
