import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isValidName, reorder } from './validation';
import {
  listSubjects,
  createSubject,
  renameSubject,
  deleteSubject,
  countSubjectImpact,
  saveSubjectOrder,
  type Subject,
  type SubjectImpact,
} from './api';

/** 科目一覧。決定表「科目の管理」 spec/tables/02-subject.jsonl に対応する。 */
export function SubjectsPage() {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleting, setDeleting] = useState<{ subject: Subject; impact: SubjectImpact } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSubjects(await listSubjects());
    } catch (e) {
      // 列12: 失敗した旨を出し、再試行の導線を残す
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 操作を1つ実行して一覧を読み直す。二重送信を防ぐ。 */
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setSubjects(await listSubjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  // 列1〜列4: 名前が空・空白だけなら追加できない。重複は許す
  const canAdd = isValidName(newName) && !busy;

  async function handleDrop(toIndex: number) {
    const fromIndex = draggingIndex;
    setDraggingIndex(null);
    if (fromIndex === null || fromIndex === toIndex) return;

    const before = subjects;
    const next = reorder(subjects, fromIndex, toIndex);
    setSubjects(next); // 先に動かして待たせない
    try {
      await saveSubjectOrder(next.map((s) => s.id));
    } catch (e) {
      // 保存できなければ元の並びに戻す
      setSubjects(before);
      setError(e instanceof Error ? e.message : '並べ替えの保存に失敗しました');
    }
  }

  if (loading) {
    return <p className="p-10 text-sm text-stone-500">読み込んでいます…</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6 sm:p-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl">科目</h1>
        <span className="grow" />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canAdd) return;
            void run(async () => {
              await createSubject(newName, subjects.length);
              setNewName('');
            });
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="科目名"
            aria-label="科目名"
            className="h-11 rounded border-2 border-stone-900 px-3 dark:border-stone-100 dark:bg-stone-800"
          />
          <button
            type="submit"
            disabled={!canAdd}
            className="h-11 rounded border-2 border-stone-900 bg-stone-900 px-4 text-stone-50 disabled:opacity-40 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
          >
            ＋ 追加
          </button>
        </form>
      </div>

      {error !== '' && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded border-2 border-orange-700 bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-950/40"
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

      {/* 列11: 1件も無いときは案内を出す */}
      {subjects.length === 0 ? (
        <p className="rounded border-2 border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
          科目がまだありません。上の欄から追加してください。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {subjects.map((subject, index) => (
            <li
              key={subject.id}
              draggable={editingId !== subject.id}
              onDragStart={() => setDraggingIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void handleDrop(index)}
              className="flex flex-wrap items-center gap-3 rounded-md border-2 border-stone-900 bg-white p-4 dark:border-stone-100 dark:bg-stone-900"
            >
              {editingId === subject.id ? (
                <form
                  className="flex grow flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!isValidName(editingName)) return;
                    void run(async () => {
                      await renameSubject(subject.id, editingName);
                      setEditingId(null);
                    });
                  }}
                >
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    aria-label="新しい科目名"
                    autoFocus
                    className="h-11 grow rounded border-2 border-stone-900 px-3 dark:border-stone-100 dark:bg-stone-800"
                  />
                  <button
                    type="submit"
                    disabled={!isValidName(editingName) || busy}
                    className="h-11 rounded border-2 border-stone-900 px-4 disabled:opacity-40 dark:border-stone-100"
                  >
                    確定
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="h-11 rounded border border-stone-400 px-4 text-stone-600 dark:text-stone-300"
                  >
                    やめる
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/subjects/${subject.id}`)}
                    className="flex grow flex-col items-start gap-1 text-left"
                  >
                    <span className="text-lg">{subject.name}</span>
                    <span className="text-xs text-stone-500">
                      教材 {subject.materialCount} ・ キーワード {subject.keywordCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(subject.id);
                      setEditingName(subject.name);
                    }}
                    className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
                  >
                    名前を変更
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        const impact = await countSubjectImpact(subject.id);
                        setDeleting({ subject, impact });
                      })
                    }
                    className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
                  >
                    削除
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {subjects.length > 1 && (
        <p className="text-center text-xs text-stone-400">行をドラッグして並べ替え</p>
      )}

      {/* 列6〜列9: 消えるものの件数を見せてから確認する */}
      {deleting && (
        <ConfirmDialog
          title={`「${deleting.subject.name}」を削除しますか`}
          confirmLabel="削除する"
          destructive
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.subject.id;
            setDeleting(null);
            void run(() => deleteSubject(id));
          }}
        >
          {deleting.impact.materialCount === 0 ? (
            <p>この科目には教材がありません。</p>
          ) : (
            <p>
              教材 {deleting.impact.materialCount} 件、キーワード {deleting.impact.keywordCount}{' '}
              件、解答履歴 {deleting.impact.answerLogCount} 件もあわせて消えます。
            </p>
          )}
          <p className="mt-2">この操作は取り消せません。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
