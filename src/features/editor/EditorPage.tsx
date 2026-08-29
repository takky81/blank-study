import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isValidName } from '@/features/subjects/validation';
import { ChapterTree } from '@/features/chapters/ChapterTree';
import { applyMove, type ChapterRow } from '@/features/chapters/tree';
import {
  getMaterialName,
  listChapters,
  createChapter,
  renameChapter,
  deleteChapter,
  countChapterImpact,
  saveChapterTree,
  type ChapterImpact,
} from '@/features/chapters/api';

/**
 * 教材編集画面。
 * この段階では章ツリーの操作（決定表「章の管理」）まで。
 * 本文の編集とプレビューは決定表「編集画面の操作」で足す。
 */
export function EditorPage() {
  const { materialId = '' } = useParams();

  const [materialName, setMaterialName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleting, setDeleting] = useState<{ row: ChapterRow; impact: ChapterImpact } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [name, rows] = await Promise.all([getMaterialName(materialId), listChapters(materialId)]);
      setNotFound(name === null);
      setMaterialName(name);
      setChapters(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setChapters(await listChapters(materialId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  /** 並べ替えとネスト変更。先に画面を動かし、保存できなければ元に戻す（列13）。 */
  async function move(parentId: string | null, index?: number) {
    const movingId = draggingId;
    setDraggingId(null);
    if (movingId === null) return;

    const before = chapters;
    const after = applyMove(chapters, movingId, parentId, index);
    if (after === before) return;
    setChapters(after);
    try {
      await saveChapterTree(before, after);
    } catch (e) {
      setChapters(before);
      setError(e instanceof Error ? e.message : '並べ替えの保存に失敗しました');
    }
  }

  const selected = chapters.find((c) => c.id === selectedId) ?? null;

  if (loading) return <p className="p-10 text-sm text-stone-500">読み込んでいます…</p>;

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-4 p-10">
        <p className="text-sm text-stone-500">この教材は見つかりませんでした。</p>
        <Link to="/" className="rounded border-2 border-stone-900 px-4 py-2 dark:border-stone-100">
          科目一覧へ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-stone-900 px-6 py-3 dark:border-stone-100">
        <h1 className="text-xl">{materialName}</h1>
        <span className="grow" />
      </div>

      {error !== '' && (
        <div
          role="alert"
          className="m-4 flex items-center gap-3 rounded border-2 border-orange-700 bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-950/40"
        >
          <span className="grow">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="h-9 rounded border border-orange-700 px-3"
          >
            再試行
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <aside className="flex w-full flex-col gap-3 rounded-md border-2 border-stone-900 bg-white p-3 sm:w-72 dark:border-stone-100 dark:bg-stone-900">
          <div className="flex items-center gap-2">
            <span className="grow text-sm text-stone-500">章</span>
            <button
              type="button"
              onClick={() => {
                setNewTitle('');
                setCreating(true);
              }}
              className="h-9 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
            >
              ＋ 章
            </button>
          </div>

          {creating && (
            <form
              className="flex flex-col gap-2 rounded border border-stone-300 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!isValidName(newTitle)) return;
                const siblings = chapters.filter((c) => c.parentId === selectedId).length;
                void run(async () => {
                  await createChapter(materialId, selectedId, newTitle, siblings);
                  setCreating(false);
                });
              }}
            >
              <span className="text-xs text-stone-500">
                {selected ? `「${selected.title}」の下に追加` : '最上位に追加'}
              </span>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                aria-label="章タイトル"
                autoFocus
                className="h-11 rounded border-2 border-stone-900 px-3 dark:border-stone-100 dark:bg-stone-800"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!isValidName(newTitle) || busy}
                  className="h-11 grow rounded border-2 border-stone-900 px-3 disabled:opacity-40 dark:border-stone-100"
                >
                  作成
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
                >
                  やめる
                </button>
              </div>
            </form>
          )}

          <ChapterTree
            rows={chapters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDragStartChapter={setDraggingId}
            onDropOnChapter={(targetId) => void move(targetId)}
            onDropInGap={(parentId, index) => void move(parentId, index)}
          />

          {chapters.length === 0 && (
            <p className="py-6 text-center text-xs text-stone-400">
              章がありません。「＋ 章」から追加してください。
            </p>
          )}

          {/* 列10: 教材をまたぐ移動は用意しない */}
          <p className="border-t border-stone-200 pt-2 text-xs text-stone-400 dark:border-stone-700">
            ドラッグで並べ替え・ネスト変更／別の教材へはエクスポートして取り込む
          </p>
        </aside>

        <section className="flex grow flex-col gap-3 rounded-md border-2 border-stone-900 bg-white p-4 dark:border-stone-100 dark:bg-stone-900">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {renaming ? (
                  <form
                    className="flex grow flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!isValidName(renameTitle)) return;
                      void run(async () => {
                        await renameChapter(selected.id, renameTitle);
                        setRenaming(false);
                      });
                    }}
                  >
                    <input
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      aria-label="新しい章タイトル"
                      autoFocus
                      className="h-11 grow rounded border-2 border-stone-900 px-3 dark:border-stone-100 dark:bg-stone-800"
                    />
                    <button
                      type="submit"
                      disabled={!isValidName(renameTitle) || busy}
                      className="h-11 rounded border-2 border-stone-900 px-4 disabled:opacity-40 dark:border-stone-100"
                    >
                      確定
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(false)}
                      className="h-11 rounded border border-stone-400 px-4 text-sm text-stone-600 dark:text-stone-300"
                    >
                      やめる
                    </button>
                  </form>
                ) : (
                  <>
                    <h2 className="grow text-lg">{selected.title}</h2>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameTitle(selected.title);
                        setRenaming(true);
                      }}
                      className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
                    >
                      章名を変更
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          const impact = await countChapterImpact(materialId, selected.id);
                          setDeleting({ row: selected, impact });
                        })
                      }
                      className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
                    >
                      章を削除
                    </button>
                  </>
                )}
              </div>
              <p className="py-10 text-center text-sm text-stone-400">
                本文の編集とプレビューはこれから作る。決定表「編集画面の操作」に対応させる。
              </p>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-stone-400">
              左の一覧から章を選んでください。
            </p>
          )}
        </section>
      </div>

      {deleting && (
        <ConfirmDialog
          title={`「${deleting.row.title}」を削除しますか`}
          confirmLabel="削除する"
          destructive
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.row.id;
            setDeleting(null);
            setSelectedId(null);
            void run(() => deleteChapter(materialId, id));
          }}
        >
          <p>
            配下もあわせて 章 {deleting.impact.chapterCount} 件、キーワード{' '}
            {deleting.impact.keywordCount} 件が対象です。
          </p>
          <p className="mt-2">
            キーワードと解答履歴は残りますが、本文から消えるため出題されなくなります。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
