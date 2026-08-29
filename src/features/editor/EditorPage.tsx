import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isValidName } from "@/features/subjects/validation";
import { ChapterTree } from "@/features/chapters/ChapterTree";
import { applyMove, type ChapterRow } from "@/features/chapters/tree";
import {
  getMaterialName,
  listChapters,
  getChapterBody,
  createChapter,
  renameChapter,
  deleteChapter,
  countChapterImpact,
  saveChapterTree,
  type ChapterImpact,
} from "@/features/chapters/api";
import {
  applyKeywordToBody,
  canCreateKeyword,
  expandBody,
  removeKeywordFromBody,
  type KeywordFields,
} from "@/lib/body";
import type { ParsedKeyword } from "@/lib/keyword";
import type { Blank } from "@/lib/markdown";
import {
  listKeywords,
  prepareSave,
  commitSave,
  type KeywordRow,
  type SavePreparation,
} from "./api";
import { ConflictDialog } from "@/components/ConflictDialog";
import { createSubmitGuard } from "@/lib/submitGuard";
import { BodyEditor } from "./BodyEditor";
import { Preview } from "./Preview";
import { KeywordDialog, type KeywordDraft } from "./KeywordDialog";
import { ImportControl } from "@/features/transfer/ImportControl";

type Tab = "chapters" | "edit" | "preview";

/** プレビューの選択範囲を本文の位置に直す。文字には data-start を持たせてある。 */
function readPreviewSelection(
  root: HTMLElement | null,
): { start: number; end: number } | null {
  if (!root) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;

  const offsetOf = (node: Node, within: number): number | null => {
    const element =
      node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : (node as HTMLElement);
    const base = element?.closest("[data-start]")?.getAttribute("data-start");
    if (base === null || base === undefined) return null;
    return Number(base) + within;
  };

  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return null;
  return { start, end };
}

/**
 * 教材編集画面。
 * 決定表「章の管理」「編集画面の操作」「保存と正規化」に対応する。
 */
export function EditorPage() {
  const { materialId = "" } = useParams();

  const [materialName, setMaterialName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleting, setDeleting] = useState<{
    row: ChapterRow;
    impact: ChapterImpact;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [draft, setDraft] = useState<KeywordDraft | null>(null);
  const [leaving, setLeaving] = useState<{ to: string } | null>(null);
  /** 保存の確認待ち。差分確認で選んでから書き込む（決定表「保存時の上書き確認」） */
  const [pending, setPending] = useState<SavePreparation | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, boolean>>({});
  /** ダイアログで内容を変えたキーワード。確認を挟まない（列1） */
  const [trusted, setTrusted] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("chapters");
  const [narrow, setNarrow] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  // 保存が遅いときに二重に送らない（決定表「表示設定と共通の振る舞い」列12）
  const saveGuard = useRef(createSubmitGuard());
  const dirty = selectedId !== null && body !== savedBody;

  const byId = useMemo(() => {
    const map = new Map<string, KeywordFields>();
    for (const k of keywords) {
      map.set(k.docId, {
        answers: k.answers,
        tags: k.tags,
        wrongChoices: k.wrongChoices,
      });
    }
    return map;
  }, [keywords]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [name, rows, words] = await Promise.all([
        getMaterialName(materialId),
        listChapters(materialId),
        listKeywords(materialId),
      ]);
      setNotFound(name === null);
      setMaterialName(name);
      setChapters(rows);
      setKeywords(words);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 画面幅が狭いときはタブで切り替える（決定表「編集画面の操作」列13）
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // 未保存のまま離れようとしたら確認する（決定表「保存と正規化」列11）
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // プレビューの選択も編集領域の選択と同じに扱う（列3・列15）
  useEffect(() => {
    const onSelectionChange = () => {
      const picked = readPreviewSelection(previewRef.current);
      if (picked) setSelection(picked);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setChapters(await listChapters(materialId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  /** 章を開いて展開形式の本文を見せる（決定表「保存と正規化」列6）。 */
  const openChapter = useCallback(
    async (id: string) => {
      setError("");
      try {
        const stored = await getChapterBody(id);
        const expanded = expandBody(stored, byId);
        setSelectedId(id);
        setBody(expanded);
        setSavedBody(expanded);
        setSelection(null);
        if (narrow) setTab("edit");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "本文の読み込みに失敗しました",
        );
      }
    },
    [byId, narrow],
  );

  /** 未保存の変更があるときは章の移動を確認する（決定表「保存と正規化」列10）。 */
  function selectChapter(id: string) {
    if (id === selectedId) return;
    if (dirty) {
      setLeaving({ to: id });
      return;
    }
    void openChapter(id);
  }

  async function save() {
    if (!selectedId || busy) return;
    await saveGuard.current.run(async () => {
      setBusy(true);
      setError("");
      try {
        const preparation = await prepareSave(materialId, body, trusted);
        if (preparation.conflicts.length > 0) {
          // 既定は登録済みを残す。上書きは明示の操作にする（列5）
          setResolutions(
            Object.fromEntries(
              preparation.conflicts.map((c) => [c.docId, false]),
            ),
          );
          setPending(preparation);
          return;
        }
        await commit(preparation, []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存に失敗しました");
      } finally {
        setBusy(false);
      }
    });
  }

  async function commit(preparation: SavePreparation, overwrite: string[]) {
    if (!selectedId) return;
    const saved = await commitSave(
      materialId,
      selectedId,
      preparation,
      overwrite,
    );
    setBody(saved);
    setSavedBody(saved);
    setTrusted(new Set());
    setKeywords(await listKeywords(materialId));
  }

  /** 並べ替えとネスト変更。先に画面を動かし、保存できなければ元に戻す（章の管理 列13）。 */
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
      setError(e instanceof Error ? e.message : "並べ替えの保存に失敗しました");
    }
  }

  const selected = chapters.find((c) => c.id === selectedId) ?? null;
  const canCreate =
    selection !== null &&
    canCreateKeyword(body, selection.start, selection.end);

  function openNewKeyword() {
    if (!selection) return;
    setDraft({
      answers: [body.slice(selection.start, selection.end)],
      docId: null,
      tags: [],
      wrongChoices: [],
      start: selection.start,
      end: selection.end,
      existing: false,
    });
  }

  /** 空欄をクリックしたら登録済みの内容を入れて開く（決定表「編集画面の操作」列6）。 */
  function openBlank(blank: Blank) {
    const stored = blank.docId === null ? undefined : byId.get(blank.docId);
    setDraft({
      answers:
        blank.answers.length > 0 ? blank.answers : (stored?.answers ?? []),
      docId: blank.docId,
      tags: blank.tags.length > 0 ? blank.tags : (stored?.tags ?? []),
      wrongChoices:
        blank.wrongChoices.length > 0
          ? blank.wrongChoices
          : (stored?.wrongChoices ?? []),
      start: blank.start,
      end: blank.end,
      existing: true,
    });
  }

  function confirmKeyword(keyword: ParsedKeyword) {
    if (!draft) return;
    // ダイアログで決めた内容は保存時に確認しない（決定表「保存時の上書き確認」列1）
    if (keyword.docId !== null)
      setTrusted((prev) => new Set(prev).add(keyword.docId as string));
    setBody(applyKeywordToBody(body, draft.start, draft.end, keyword));
    setDraft(null);
    setSelection(null);
  }

  function releaseKeyword() {
    if (!draft) return;
    setBody(removeKeywordFromBody(body, draft.start, draft.answers));
    setDraft(null);
    setSelection(null);
  }

  if (loading)
    return <p className="p-10 text-sm text-stone-500">読み込んでいます…</p>;

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-4 p-10">
        <p className="text-sm text-stone-500">
          この教材は見つかりませんでした。
        </p>
        <Link
          to="/"
          className="rounded border-2 border-stone-900 px-4 py-2 dark:border-stone-100"
        >
          科目一覧へ戻る
        </Link>
      </div>
    );
  }

  const showTree = !narrow || tab === "chapters";
  const showEdit = selected !== null && (!narrow || tab === "edit");
  const showPreview = selected !== null && (!narrow || tab === "preview");

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-stone-900 px-6 py-3 dark:border-stone-100">
        <h1 className="text-xl">{materialName}</h1>
        {dirty && (
          <span className="text-xs text-orange-700">
            未保存の変更があります
          </span>
        )}
        <span className="grow" />
        <button
          type="button"
          onClick={openNewKeyword}
          disabled={!canCreate}
          className="h-11 rounded border-2 border-stone-900 px-4 disabled:opacity-40 dark:border-stone-100"
        >
          キーワードを作成
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || busy}
          className="h-11 rounded border-2 border-stone-900 bg-stone-900 px-5 text-stone-50 disabled:opacity-40 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
        >
          保存
        </button>
      </div>

      {narrow && (
        <div
          role="tablist"
          className="flex border-b border-stone-300 dark:border-stone-700"
        >
          {(
            [
              ["chapters", "章"],
              ["edit", "編集"],
              ["preview", "プレビュー"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={
                tab === value
                  ? "h-11 grow border-b-2 border-stone-900 text-sm dark:border-stone-100"
                  : "h-11 grow text-sm text-stone-500"
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error !== "" && (
        <div
          role="alert"
          className="m-4 flex items-center gap-3 rounded border-2 border-orange-700 bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-950/40"
        >
          <span className="grow">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="h-11 rounded border border-orange-700 px-3"
          >
            再試行
          </button>
        </div>
      )}

      <div className="flex min-h-[70dvh] flex-col gap-4 p-4 md:flex-row">
        {showTree && (
          <aside className="flex w-full flex-col gap-3 rounded-md border-2 border-stone-900 bg-white p-3 md:w-64 dark:border-stone-100 dark:bg-stone-900">
            <div className="flex items-center gap-2">
              <span className="grow text-sm text-stone-500">章</span>
              <button
                type="button"
                onClick={() => {
                  setNewTitle("");
                  setCreating(true);
                }}
                className="h-9 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
              >
                ＋ 章
              </button>
            </div>

            {/* 決定表「インポートの単位」列2: 選んでいる章の下に取り込む */}
            <ImportControl
              label="章を取り込む"
              testId="import-chapter"
              target={() => ({
                kind: "chapter",
                materialId,
                parentId: selectedId,
              })}
              onDone={() => void load()}
              onError={setError}
            />

            {creating && (
              <form
                className="flex flex-col gap-2 rounded border border-stone-300 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!isValidName(newTitle)) return;
                  const siblings = chapters.filter(
                    (c) => c.parentId === selectedId,
                  ).length;
                  void run(async () => {
                    await createChapter(
                      materialId,
                      selectedId,
                      newTitle,
                      siblings,
                    );
                    setCreating(false);
                  });
                }}
              >
                <span className="text-xs text-stone-500">
                  {selected
                    ? `「${selected.title}」の下に追加`
                    : "最上位に追加"}
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
              onSelect={selectChapter}
              onDragStartChapter={setDraggingId}
              onDropOnChapter={(targetId) => void move(targetId)}
              onDropInGap={(parentId, index) => void move(parentId, index)}
            />

            {chapters.length === 0 && (
              <p className="py-6 text-center text-xs text-stone-400">
                章がありません。「＋ 章」から追加してください。
              </p>
            )}

            {/* 章の管理 列10: 教材をまたぐ移動は用意しない */}
            <p className="border-t border-stone-200 pt-2 text-xs text-stone-400 dark:border-stone-700">
              ドラッグで並べ替え・ネスト変更／別の教材へはエクスポートして取り込む
            </p>
          </aside>
        )}

        {selected === null ? (
          <section className="flex grow items-center justify-center rounded-md border-2 border-stone-900 bg-white p-4 dark:border-stone-100 dark:bg-stone-900">
            <p className="text-sm text-stone-400">
              左の一覧から章を選んでください。
            </p>
          </section>
        ) : (
          <section className="flex grow flex-col gap-3">
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
                        const impact = await countChapterImpact(
                          materialId,
                          selected.id,
                        );
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

            <div className="flex grow flex-col gap-4 lg:flex-row">
              {showEdit && (
                <BodyEditor
                  value={body}
                  onChange={(next) => {
                    setBody(next);
                    setSelection(null);
                  }}
                  onSelect={(start, end) =>
                    setSelection(start === end ? null : { start, end })
                  }
                />
              )}
              {showPreview && (
                <div ref={previewRef} className="flex grow flex-col">
                  <Preview
                    body={body}
                    answersOf={(docId) => byId.get(docId)?.answers ?? []}
                    onOpenBlank={openBlank}
                  />
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {draft && (
        <KeywordDialog
          draft={draft}
          onConfirm={confirmKeyword}
          onRelease={releaseKeyword}
          onCancel={() => setDraft(null)}
        />
      )}

      {pending && (
        <ConflictDialog
          conflicts={pending.conflicts}
          resolutions={resolutions}
          onChange={(docId, overwrite) =>
            setResolutions((r) => ({ ...r, [docId]: overwrite }))
          }
          busy={busy}
          description="登録済みの内容と食い違うキーワードがあります。どちらを残すか選んでください。"
          onCancel={() => setPending(null)}
          onApply={() => {
            const preparation = pending;
            const overwrite = Object.entries(resolutions)
              .filter(([, value]) => value)
              .map(([docId]) => docId);
            setPending(null);
            setBusy(true);
            void commit(preparation, overwrite)
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : "保存に失敗しました"),
              )
              .finally(() => setBusy(false));
          }}
        />
      )}

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
            配下もあわせて 章 {deleting.impact.chapterCount} 件、キーワード{" "}
            {deleting.impact.keywordCount} 件が対象です。
          </p>
          <p className="mt-2">
            キーワードと解答履歴は残りますが、本文から消えるため出題されなくなります。
          </p>
        </ConfirmDialog>
      )}

      {leaving && (
        <ConfirmDialog
          title="未保存の変更があります"
          confirmLabel="保存せずに移動"
          cancelLabel="編集に戻る"
          busy={busy}
          onCancel={() => setLeaving(null)}
          onConfirm={() => {
            const to = leaving.to;
            setLeaving(null);
            void openChapter(to);
          }}
        >
          <p>
            この章の変更はまだ保存されていません。移動すると変更は失われます。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
