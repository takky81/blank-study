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
  const [deleting, setDeleting] = useState<{
    subject: Subject;
    impact: SubjectImpact;
  } | null>(null);
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
    return <p className="p-10 text-[13px] text-muted">読み込んでいます…</p>;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6 sm:px-10 sm:py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px]">科目</h1>
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
            className="field"
          />
          <button type="submit" disabled={!canAdd} className="btn-p">
            ＋ 科目を追加
          </button>
        </form>
      </div>

      {error !== '' && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded border-2 border-warn bg-warn-panel p-3 text-[14px] text-warn"
        >
          <span className="grow">{error}</span>
          <button type="button" onClick={() => void load()} className="btn-s border-warn text-warn">
            再試行
          </button>
        </div>
      )}

      {/* 列11: 1件も無いときは案内を出す */}
      {subjects.length === 0 ? (
        <p className="rounded border-2 border-dashed border-line p-10 text-center text-[13px] text-muted">
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
              className="card card-act flex flex-wrap items-center gap-3 p-4"
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
                    className="field grow"
                  />
                  <button
                    type="submit"
                    disabled={!isValidName(editingName) || busy}
                    className="btn"
                  >
                    確定
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="btn-s">
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
                    <span className="text-[17px]">{subject.name}</span>
                    <span className="text-[13px] text-muted">
                      教材 {subject.materialCount} 件 ・ キーワード {subject.keywordCount} 件
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(subject.id);
                      setEditingName(subject.name);
                    }}
                    className="btn-s"
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
                    className="btn-s"
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
        <p className="text-center text-[12px] text-muted">行をドラッグして並べ替え</p>
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
