import { useEffect, useRef, useState } from 'react';
import type { ParsedKeyword } from '@/lib/keyword';
import { canConfirmKeyword } from '@/lib/body';

/** 1行1件で読み書きする。前後の空白と空行は落とす。 */
function toLines(values: readonly string[]): string {
  return values.join('\n');
}

function fromLines(text: string): string[] {
  const values = text
    .split('\n')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  return [...new Set(values)];
}

export type KeywordDraft = ParsedKeyword & {
  /** 本文の中で書き換える範囲 */
  start: number;
  end: number;
  /** 既存の記述を開いているか。解除できるのはこのときだけ */
  existing: boolean;
};

/**
 * キーワード編集ダイアログ。
 * 決定表「編集画面の操作」列3・列6・列7・列8・列9・列10・列11 に対応する。
 */
export function KeywordDialog({
  draft,
  onConfirm,
  onRelease,
  onCancel,
}: {
  draft: KeywordDraft;
  onConfirm: (keyword: ParsedKeyword) => void;
  onRelease: () => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState(toLines(draft.answers));
  const [tags, setTags] = useState(toLines(draft.tags));
  const [wrong, setWrong] = useState(toLines(draft.wrongChoices));
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const keyword: ParsedKeyword = {
    answers: fromLines(answers),
    docId: draft.docId,
    tags: fromLines(tags),
    wrongChoices: fromLines(wrong),
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="キーワードの編集"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center sm:p-6"
    >
      <div className="flex max-h-dvh w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-md border-2 border-ink bg-panel p-6 sm:rounded-md">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[17px]">キーワードの編集</h2>
          <span className="font-mono text-[12px] text-muted">id = {draft.docId}</span>
        </div>

        <label className="flex flex-col gap-1 text-[13px] text-ink-soft">
          正答
          <span className="text-[12px] text-muted">1行に1件。どれを書いても正解にする</span>
          <textarea
            aria-label="正答"
            value={answers}
            rows={3}
            autoFocus
            onChange={(e) => setAnswers(e.target.value)}
            className="field h-auto py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-[13px] text-ink-soft">
          タグ
          <span className="text-[12px] text-muted">1行に1件。誤答選択肢の自動生成に使う</span>
          <textarea
            aria-label="タグ"
            value={tags}
            rows={2}
            onChange={(e) => setTags(e.target.value)}
            className="field h-auto py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-[13px] text-ink-soft">
          誤答選択肢
          <span className="text-[12px] text-muted">
            1行に1件。空にすると同じタグから自動で集める
          </span>
          <textarea
            aria-label="誤答選択肢"
            value={wrong}
            rows={2}
            onChange={(e) => setWrong(e.target.value)}
            className="field h-auto py-2"
          />
        </label>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {draft.existing && (
            <button type="button" onClick={onRelease} className="btn-s">
              キーワードを解除
            </button>
          )}
          <span className="grow" />
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn">
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onConfirm(keyword)}
            disabled={!canConfirmKeyword(keyword)}
            className="btn-p"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
