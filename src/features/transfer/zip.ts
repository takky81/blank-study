/**
 * エクスポート zip の組み立てと、インポート zip の読み取り。
 * 決定表「エクスポート」「インポートの単位」に対応する。
 * zip の構成は docs/仕様書.md §4.4 を参照。
 *
 * ここでは zip の圧縮そのものは扱わず、パスと本文の対応だけを扱う。
 */

import { expandBody, type KeywordFields } from '@/lib/body';

export type ExportChapter = {
  id: string;
  parentId: string | null;
  title: string;
  sortOrder: number;
  body: string;
};

export type ImportedChapter = {
  title: string;
  body: string;
  sortOrder: number;
  children: ImportedChapter[];
};

/** 連番プレフィックス。並び順をフォルダ名・ファイル名で表す（仕様書 §4.4）。 */
const SEQUENCE = /^(\d+)[_-](.*)$/;
const UNSAFE = /[/\\:*?"<>|]/g;

/** ファイル名に使えない文字を置き換える（決定表「エクスポート」列8）。 */
export function safeFileName(title: string): string {
  return title.replace(UNSAFE, '_').trim().replace(/\.+$/, '').trim();
}

function prefix(index: number): string {
  return String((index + 1) * 10).padStart(3, '0');
}

/**
 * 教材を zip の中身にする（決定表「エクスポート」列1・列2・列3）。
 * キーは zip の中のパス、値はその章の本文。
 */
export function buildFiles(
  chapters: readonly ExportChapter[],
  keywords: ReadonlyMap<string, KeywordFields>,
): Record<string, string> {
  if (chapters.length === 0) throw new Error('章がない教材はエクスポートできません');

  const files: Record<string, string> = {};

  const walk = (parentId: string | null, dir: string): void => {
    const siblings = chapters
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // 同じ親に同じタイトルがあっても、連番が付くので重ならない（列9）
    siblings.forEach((chapter, index) => {
      const name = safeFileName(chapter.title) || '章';
      const base = `${dir}${prefix(index)}_${name}`;
      const hasChildren = chapters.some((c) => c.parentId === chapter.id);
      // 本文は章の最初の1か所だけフル形式にする（列1）
      const body = expandBody(chapter.body, keywords);

      if (hasChildren) {
        files[`${base}/index.md`] = body;
        walk(chapter.id, `${base}/`);
      } else {
        files[`${base}.md`] = body;
      }
    });
  };

  walk(null, '');
  return files;
}

/** パスの一部から連番と章タイトルを読む。連番が無ければ名前順に並べる（列3・列8）。 */
function readSegment(segment: string): { order: number | null; title: string } {
  const matched = SEQUENCE.exec(segment);
  if (!matched) return { order: null, title: segment };
  return { order: Number(matched[1]), title: matched[2] as string };
}

type Draft = {
  title: string;
  body: string;
  order: number | null;
  name: string;
  children: Map<string, Draft>;
};

function draftOf(parent: Map<string, Draft>, segment: string): Draft {
  const { order, title } = readSegment(segment);
  const found = parent.get(segment);
  if (found) return found;
  const created: Draft = { title, body: '', order, name: segment, children: new Map() };
  parent.set(segment, created);
  return created;
}

function toChapters(drafts: Map<string, Draft>): ImportedChapter[] {
  return [...drafts.values()]
    .sort((a, b) => {
      if (a.order !== null && b.order !== null) return a.order - b.order;
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((draft, index) => ({
      title: draft.title,
      body: draft.body,
      sortOrder: index,
      children: toChapters(draft.children),
    }));
}

/**
 * zip の中身から章の木を組み立てる（決定表「インポートの単位」列3・列4・列6・列8・列9）。
 * .md 以外のファイルは読み飛ばす。
 */
export function parseFiles(files: Record<string, string>): ImportedChapter[] {
  const roots = new Map<string, Draft>();
  let found = 0;

  for (const [path, content] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith('.md')) continue;
    found += 1;

    const segments = path.split('/').filter((s) => s !== '');
    const last = segments[segments.length - 1] as string;
    const folders = segments.slice(0, -1);

    let level = roots;
    let current: Draft | null = null;
    for (const folder of folders) {
      current = draftOf(level, folder);
      level = current.children;
    }

    if (last.toLowerCase() === 'index.md') {
      // フォルダ自身の本文（列4）
      if (current) current.body = content;
      continue;
    }

    const leaf = draftOf(level, last.replace(/\.md$/i, ''));
    leaf.body = content;
  }

  if (found === 0) throw new Error('取り込める章がありません');
  return toChapters(roots);
}
