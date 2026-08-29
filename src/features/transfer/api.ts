import { supabase } from '@/lib/supabase';
import { assignDocIds, collapseBody, expandBody, type KeywordFields } from '@/lib/body';
import { listKeywords } from '@/features/editor/api';
import { decodeZip, encodeZip, zipFileName } from './archive';
import { buildFiles, parseFiles, type ExportChapter, type ImportedChapter } from './zip';
import { matchKeywords, type Conflict, type ImportedKeyword, type Plan } from './match';

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

/** 教材を zip にする（決定表「エクスポート」列1-列4・列6-列9）。 */
export async function exportMaterial(
  materialId: string,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const material = await supabase
    .from('materials')
    .select('name')
    .eq('id', materialId)
    .maybeSingle();
  if (material.error) fail('教材の取得に失敗しました', material.error);
  if (!material.data) throw new Error('教材が見つかりません');

  const chapters = await supabase
    .from('chapters')
    .select('id, parent_id, title, body, sort_order')
    .eq('material_id', materialId)
    .order('sort_order');
  if (chapters.error) fail('章の取得に失敗しました', chapters.error);

  const rows: ExportChapter[] = (chapters.data ?? []).map((c) => ({
    id: c.id,
    parentId: c.parent_id,
    title: c.title,
    sortOrder: c.sort_order,
    body: c.body ?? '',
  }));

  const keywords = await listKeywords(materialId);
  const byId = new Map<string, KeywordFields>(
    keywords.map((k) => [
      k.docId,
      { answers: k.answers, tags: k.tags, wrongChoices: k.wrongChoices },
    ]),
  );

  return { fileName: zipFileName(material.data.name), bytes: encodeZip(buildFiles(rows, byId)) };
}

/** 取り込み先。教材まるごとか、既存の教材の章の下か（決定表「インポートの単位」列1・列2）。 */
export type ImportTarget =
  | { kind: 'material'; subjectId: string; name: string }
  | { kind: 'chapter'; materialId: string; parentId: string | null };

type FlatChapter = {
  tempId: string;
  parentTempId: string | null;
  title: string;
  body: string;
  sortOrder: number;
};

export type ImportPlan = {
  target: ImportTarget;
  chapters: FlatChapter[];
  /** 確認なしで適用できるもの */
  apply: Plan[];
  /** 差分確認が要るもの（列4・列5） */
  conflicts: Conflict[];
  /** 記述がどの章に出てきたか。キーワードの所属を決めるのに使う */
  chapterOf: Map<string, string>;
};

function flatten(nodes: readonly ImportedChapter[]): FlatChapter[] {
  const flat: FlatChapter[] = [];
  let next = 0;

  const walk = (list: readonly ImportedChapter[], parentTempId: string | null): void => {
    for (const node of list) {
      const tempId = `c${next++}`;
      flat.push({
        tempId,
        parentTempId,
        title: node.title,
        body: node.body,
        sortOrder: node.sortOrder,
      });
      walk(node.children, tempId);
    }
  };

  walk(nodes, null);
  return flat;
}

/**
 * zip を読んで、そのまま取り込めるものと確認が要るものに分ける。
 * ここでは何も書き込まない（決定表「インポート時のキーワード突合」列1-列5・列10）。
 */
export async function prepareImport(bytes: Uint8Array, target: ImportTarget): Promise<ImportPlan> {
  const chapters = flatten(parseFiles(decodeZip(bytes)));

  const existing =
    target.kind === 'chapter'
      ? await listKeywords(target.materialId)
      : ([] as Awaited<ReturnType<typeof listKeywords>>);
  const existingFields = new Map<string, KeywordFields>(
    existing.map((k) => [
      k.docId,
      { answers: k.answers, tags: k.tags, wrongChoices: k.wrongChoices },
    ]),
  );

  // 記述にIDを配る。教材内で一意になればよい（決定表「キーワードIDの採番」列4・列5）
  const taken = new Set(existingFields.keys());
  const incoming: ImportedKeyword[] = [];
  const chapterOf = new Map<string, string>();

  const withIds = chapters.map((chapter) => {
    const assigned = assignDocIds(chapter.body, taken);
    for (const keyword of assigned.keywords) {
      taken.add(keyword.docId);
      incoming.push({
        docId: keyword.docId,
        answers: keyword.answers,
        tags: keyword.tags,
        wrongChoices: keyword.wrongChoices,
      });
      if (!chapterOf.has(keyword.docId)) chapterOf.set(keyword.docId, chapter.tempId);
    }
    // 本文は保存形式にして持つ（列8）
    return { ...chapter, body: collapseBody(assigned.body) };
  });

  const { apply, conflicts } = matchKeywords(incoming, existingFields);
  return { target, chapters: withIds, apply, conflicts, chapterOf };
}

/** 差分確認での選び方。true なら取り込んだ内容で上書きする（列6・列7）。 */
export type Resolutions = Record<string, boolean>;

/**
 * 取り込みを実行する。書き込みは1回の呼び出しにまとめ、
 * 途中で失敗したら何も変わらないようにする（列9）。
 */
export async function runImport(plan: ImportPlan, resolutions: Resolutions = {}): Promise<string> {
  const keywords = [
    ...plan.apply.map((p) => ({ docId: p.docId, fields: p.fields })),
    ...plan.conflicts
      .filter((c) => resolutions[c.docId] === true)
      .map((c) => ({ docId: c.docId, fields: c.incoming })),
  ];

  const payload = keywords
    .filter((k): k is { docId: string; fields: KeywordFields } => k.docId !== null)
    .map((k) => ({
      docId: k.docId,
      answers: k.fields.answers,
      tags: k.fields.tags,
      wrongChoices: k.fields.wrongChoices,
      chapterTempId: plan.chapterOf.get(k.docId) ?? plan.chapters[0]?.tempId ?? null,
    }));

  const { data, error } = await supabase.rpc('import_material', {
    p_subject_id: plan.target.kind === 'material' ? plan.target.subjectId : null,
    p_material_id: plan.target.kind === 'chapter' ? plan.target.materialId : null,
    p_material_name: plan.target.kind === 'material' ? plan.target.name : null,
    p_parent_id: plan.target.kind === 'chapter' ? plan.target.parentId : null,
    p_chapters: plan.chapters,
    p_keywords: payload,
  });
  if (error) fail('取り込みに失敗しました', error);
  return data as string;
}

/** zip のファイル名から教材名を作る（決定表「インポートの単位」列1）。 */
export function materialNameOf(fileName: string): string {
  return fileName.replace(/\.zip$/i, '').trim() || '取り込んだ教材';
}

/** 展開形式の本文を作る。エクスポートの単体テストと画面で使う。 */
export function expandForExport(
  body: string,
  keywords: ReadonlyMap<string, KeywordFields>,
): string {
  return expandBody(body, keywords);
}
