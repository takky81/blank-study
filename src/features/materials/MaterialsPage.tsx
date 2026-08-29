import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useTrail } from '@/components/Trail';
import { RowActions } from '@/components/RowActions';
import { ImportControl } from '@/features/transfer/ImportControl';
import { exportMaterial } from '@/features/transfer/api';
import { saveFile } from '@/features/transfer/download';
import { isValidName, reorder } from '@/features/subjects/validation';
import {
  getSubjectName,
  listMaterials,
  createMaterial,
  renameMaterial,
  deleteMaterial,
  countMaterialImpact,
  saveMaterialOrder,
  type Material,
  type MaterialImpact,
} from './api';

/** 教材一覧。決定表「教材の管理」 spec/tables/03-material.jsonl に対応する。 */
export function MaterialsPage() {
  const { subjectId = '' } = useParams();
  const navigate = useNavigate();

  const [subjectName, setSubjectName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleting, setDeleting] = useState<{
    material: Material;
    impact: MaterialImpact;
  } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [name, list] = await Promise.all([getSubjectName(subjectId), listMaterials(subjectId)]);
      setNotFound(name === null);
      setSubjectName(name);
      setMaterials(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useTrail(
    subjectName === null
      ? [{ label: '科目一覧', to: '/' }]
      : [{ label: '科目一覧', to: '/' }, { label: subjectName }],
  );

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setMaterials(await listMaterials(subjectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function handleDrop(toIndex: number) {
    const fromIndex = draggingIndex;
    setDraggingIndex(null);
    if (fromIndex === null || fromIndex === toIndex) return;

    const before = materials;
    const next = reorder(materials, fromIndex, toIndex);
    setMaterials(next);
    try {
      await saveMaterialOrder(next.map((m) => m.id));
    } catch (e) {
      setMaterials(before);
      setError(e instanceof Error ? e.message : '並べ替えの保存に失敗しました');
    }
  }

  const canAdd = isValidName(newName) && !busy;
  const subjectKeywordCount = materials.reduce((sum, m) => sum + m.keywordCount, 0);
  const subjectDueToday = materials.reduce((sum, m) => sum + m.dueToday, 0);

  if (loading) {
    return <p className="p-10 text-[13px] text-muted">読み込んでいます…</p>;
  }

  // 決定表「表示設定と共通の振る舞い」列13: 消えた科目の URL を開いても壊れない
  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-4 p-10">
        <p className="text-[13px] text-muted">この科目は見つかりませんでした。</p>
        <Link to="/" className="btn">
          科目一覧へ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6 sm:px-10 sm:py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px]">{subjectName}</h1>
        <span className="grow" />
        {/* 決定表「インポートの単位」列1: zip 1つを教材まるごととして取り込む */}
        <ImportControl
          label="インポート"
          testId="import-material"
          target={(fileName) => ({
            kind: 'material',
            subjectId,
            name: fileName,
          })}
          onDone={() => void load()}
          onError={setError}
        />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canAdd) return;
            void run(async () => {
              await createMaterial(subjectId, newName, materials.length);
              setNewName('');
            });
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="教材名"
            aria-label="教材名"
            className="field"
          />
          <button type="submit" disabled={!canAdd} className="btn-p">
            ＋ 教材を追加
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

      {/* 列11・列12: 教材があるときだけ科目全体の導線を出す */}
      {materials.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-4 rounded-md border-2 border-ink bg-accent-panel px-6 py-5">
            <div className="flex grow flex-col gap-1">
              <span className="text-[18px]">{subjectName} をまとめて解答する</span>
              <span className="text-[13px] text-ink-soft">
                {materials.length} 教材すべてが対象 ・ キーワード {subjectKeywordCount} ・
                今日の復習 {subjectDueToday} 問
              </span>
            </div>
            <button
              type="button"
              disabled={subjectKeywordCount === 0}
              onClick={() => navigate(`/subjects/${subjectId}/study`)}
              className="btn-p h-10 px-5"
            >
              科目全体で解答
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[14px] text-ink-soft">教材ごとに解答する</span>
            <span className="h-px grow bg-line" />
          </div>
        </>
      )}

      {materials.length === 0 ? (
        <p className="rounded border-2 border-dashed border-line p-10 text-center text-[13px] text-muted">
          教材がまだありません。上の欄から追加してください。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {materials.map((material, index) => (
            <li
              key={material.id}
              draggable={editingId !== material.id}
              onDragStart={() => setDraggingIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void handleDrop(index)}
              className="card card-act flex flex-wrap items-center gap-3 p-4"
            >
              {editingId === material.id ? (
                <form
                  className="flex grow flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!isValidName(editingName)) return;
                    void run(async () => {
                      await renameMaterial(material.id, editingName);
                      setEditingId(null);
                    });
                  }}
                >
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    aria-label="新しい教材名"
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
                  <div className="flex grow flex-col gap-1">
                    <span className="text-[17px]">{material.name}</span>
                    <span className="text-[13px] text-muted">
                      章 {material.chapterCount} ・ キーワード {material.keywordCount} ・ 正答率{' '}
                      {material.correctRate === null
                        ? '—'
                        : `${Math.round(material.correctRate * 100)}%`}{' '}
                      ・ 今日 {material.dueToday} 問
                    </span>
                  </div>
                  {/* 狭い画面では解答だけ残し、残りをメニューに畳む（決定表「表示設定と共通の振る舞い」列8） */}
                  <RowActions
                    primary={
                      <button
                        type="button"
                        disabled={material.keywordCount === 0}
                        onClick={() => navigate(`/materials/${material.id}/study`)}
                        className="btn-p"
                      >
                        解答
                      </button>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => navigate(`/materials/${material.id}/edit`)}
                      className="btn-s"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          const { fileName, bytes } = await exportMaterial(material.id);
                          saveFile(fileName, bytes);
                        })
                      }
                      className="btn-s"
                    >
                      エクスポート
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(material.id);
                        setEditingName(material.name);
                      }}
                      className="btn-s"
                    >
                      名前を変更
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          const impact = await countMaterialImpact(material.id);
                          setDeleting({ material, impact });
                        })
                      }
                      className="btn-s"
                    >
                      削除
                    </button>
                  </RowActions>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 列9: 科目をまたぐ移動は用意しない */}
      <p className="text-center text-[12px] text-muted">
        {materials.length > 1 ? '行をドラッグして並べ替え ／ ' : ''}
        別の科目へ移すときはエクスポートして別の科目に取り込む
      </p>

      {deleting && (
        <ConfirmDialog
          title={`「${deleting.material.name}」を削除しますか`}
          confirmLabel="削除する"
          destructive
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.material.id;
            setDeleting(null);
            void run(() => deleteMaterial(id));
          }}
        >
          <p>
            章 {deleting.impact.chapterCount} 件、キーワード {deleting.impact.keywordCount} 件、
            解答履歴 {deleting.impact.answerLogCount} 件もあわせて消えます。
          </p>
          <p className="mt-2">この操作は取り消せません。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
