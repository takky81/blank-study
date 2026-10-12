import { buildTree, type ChapterNode } from '@/features/chapters/tree';
import type { StructuredQuestion } from '@/features/questions/types';
import { parseKeywordToken, scanKeywordTokens } from '@/lib/keyword';
import { buildExchangeExport, toExchangeTarget } from './schema';
import type {
  ChapterContextV1,
  EligibilityTarget,
  ExchangeHeader,
  QuestionExchangeExportV1,
  QuestionExchangeFilterV1,
} from './types';

/** catalog所有pagingで全件取得済みのowner階層。章は親子と兄弟順の生値を受け取る。 */
export type ExchangeCatalog = Readonly<{
  subjects: readonly Readonly<{ id: string; title: string; sortOrder: number }>[];
  materials: readonly Readonly<{ id: string; subjectId: string; title: string; sortOrder: number }>[];
  chapters: readonly Readonly<{
    id: string;
    materialId: string;
    parentId: string | null;
    title: string;
    sortOrder: number;
    body: string;
  }>[];
  keywords: readonly Readonly<{ id: string; materialId: string; docId: string; answers: readonly string[]; isActive: boolean }>[];
}>;

export type EligibilityExportInput = Readonly<{
  header: ExchangeHeader;
  filters: QuestionExchangeFilterV1;
  targets: readonly EligibilityTarget[];
  catalog: ExchangeCatalog;
  /** question read contractで取得した設問（無効設問・他keyword設問はprojectionで除外する）。 */
  questions: readonly StructuredQuestion[];
}>;

/** 本文に出現するkeyword doc IDの集合（markdown-keyword-authoringの本文membership契約）。 */
function bodyDocIds(body: string): Set<string> {
  const ids = new Set<string>();
  for (const token of scanKeywordTokens(body)) {
    const docId = parseKeywordToken(token.inner)?.docId;
    if (docId) ids.add(docId);
  }
  return ids;
}

/** 教材ごとに章木をpre-order展開し、章ID → 教材内の安定順序を返す。 */
function preOrderIndex(chapters: ExchangeCatalog['chapters']): Map<string, number> {
  const byMaterial = new Map<string, ExchangeCatalog['chapters'][number][]>();
  for (const chapter of chapters) {
    const list = byMaterial.get(chapter.materialId) ?? [];
    list.push(chapter);
    byMaterial.set(chapter.materialId, list);
  }
  const index = new Map<string, number>();
  for (const list of byMaterial.values()) {
    const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let next = 0;
    const visit = (nodes: readonly ChapterNode[]) => {
      for (const node of nodes) {
        index.set(node.id, next);
        next += 1;
        visit(node.children);
      }
    };
    visit(buildTree(sorted.map(({ id, parentId, title, sortOrder }) => ({ id, parentId, title, sortOrder }))));
  }
  return index;
}

/**
 * eligibility結果へ科目・教材・本文出現章・設問版を接続し、schema v1の安定順exportへ写像する。
 * 関連章はkeywordのprovenance chapterではなく、同一教材の章本文に出現するdoc IDから決める。
 * 参照先が欠けたtargetは不完全なartifactを作らないよう例外にする。
 */
export function projectEligibilityExport(input: EligibilityExportInput): QuestionExchangeExportV1 {
  const { catalog } = input;
  const subjects = new Map(catalog.subjects.map((s) => [s.id, s]));
  const materials = new Map(catalog.materials.map((m) => [m.id, m]));
  const keywords = new Map(catalog.keywords.map((k) => [k.id, k]));
  const order = preOrderIndex(catalog.chapters);
  const docIdsByChapter = new Map(catalog.chapters.map((c) => [c.id, bodyDocIds(c.body)]));

  const targets = input.targets.map((target) => {
    const keyword = keywords.get(target.keywordId);
    if (keyword === undefined || keyword.answers.length === 0) {
      throw new Error(`Keyword not found in catalog: ${target.keywordId}`);
    }
    const chapterContexts: ChapterContextV1[] = catalog.chapters
      .filter((c) => c.materialId === keyword.materialId && docIdsByChapter.get(c.id)?.has(keyword.docId))
      .map((chapter) => {
        const material = materials.get(chapter.materialId);
        const subject = material === undefined ? undefined : subjects.get(material.subjectId);
        if (material === undefined || subject === undefined) {
          throw new Error(`Incomplete hierarchy for chapter: ${chapter.id}`);
        }
        return {
          subject: { id: subject.id, title: subject.title, sortOrder: subject.sortOrder },
          material: { id: material.id, title: material.title, sortOrder: material.sortOrder },
          chapter: { id: chapter.id, title: chapter.title, sortOrder: order.get(chapter.id) as number, bodyMarkdown: chapter.body },
        };
      });
    const seen = new Set<string>();
    const questions = input.questions
      .filter((q) => {
        if (!q.isActive || q.keywordId !== target.keywordId || seen.has(q.id)) return false;
        seen.add(q.id);
        return true;
      })
      .map((q) => ({
        questionId: q.id,
        expectedVersion: q.version,
        sortOrder: q.sortOrder,
        questionText: q.questionText,
        modelAnswer: q.modelAnswer,
        choices: [...q.choices],
        explanation: q.explanation,
        doubtNote: q.doubtFlag ? q.doubtNote : null,
      }));
    return toExchangeTarget(target, {
      keyword: { displayText: keyword.answers[0] as string, modelAnswer: keyword.answers.join('、') },
      chapterContexts,
      questions,
    });
  });

  return buildExchangeExport(input.header, input.filters, targets);
}
