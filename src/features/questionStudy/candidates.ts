import { scanKeywordTokens, parseKeywordToken } from '@/lib/keyword';
import type { StructuredQuestion } from '@/features/questions/types';

export type QuestionStudyScope =
  | Readonly<{ kind: 'subject'; id: string }>
  | Readonly<{ kind: 'material'; id: string }>
  | Readonly<{ kind: 'chapter'; id: string }>
  | Readonly<{ kind: 'keyword'; id: string }>;

export type CatalogHierarchy = Readonly<{
  subjects: readonly Readonly<{ id: string; sortOrder: number; title?: string }>[];
  materials: readonly Readonly<{ id: string; subjectId: string; sortOrder: number; title?: string }>[];
  chapters: readonly Readonly<{
    id: string;
    materialId: string;
    title?: string;
    parentId?: string | null;
    /** Catalog adapter が階層を安定した pre-order に展開した順序。 */
    sortOrder: number;
    body: string;
  }>[];
  keywords: readonly Readonly<{
    id: string;
    materialId: string;
    docId: string;
    isActive: boolean;
    /** keywordに紐づく章。本文出現を使わないkeyword範囲で所在表示に使う。 */
    chapterId?: string | null;
    /** 正解表記。先頭を表示名に使う。 */
    answers?: readonly string[];
  }>[];
}>;

export type QuestionStudyStats = Readonly<{
  questionId: string;
  askedCount: number;
  correctCount: number;
  consecutiveCorrect: number;
  intervalDays: number;
  easeFactor: number;
  dueAt: string | null;
  updatedAt: string;
}>;

export type QuestionStudyCandidate = Readonly<{
  question: StructuredQuestion;
  stats: QuestionStudyStats | null;
  subjectOrder: number;
  materialOrder: number;
  chapterOrder: number | null;
  bodyOccurrenceIndex: number | null;
  keywordOrder: number;
  questionOrder: number;
  /** 結果表示用の所在: 科目 / 教材 / 章（親から） / キーワード。名前が不明な階層は省く。 */
  breadcrumb?: readonly string[];
}>;

type RepresentativeOccurrence = Readonly<{
  chapterId: string;
  subjectOrder: number;
  materialOrder: number;
  chapterOrder: number;
  bodyOccurrenceIndex: number;
}>;

export function projectQuestionCandidates(
  scope: QuestionStudyScope,
  hierarchy: CatalogHierarchy,
  questions: readonly StructuredQuestion[],
  stats: readonly QuestionStudyStats[],
): readonly QuestionStudyCandidate[] {
  if (scope.kind === 'keyword') {
    return projectKeywordCandidates(scope.id, hierarchy, questions, stats);
  }

  const selectedChapters = chaptersInScope(scope, hierarchy);
  if (selectedChapters === null) return [];

  const subjectsById = new Map(hierarchy.subjects.map((subject) => [subject.id, subject]));
  const materialsById = new Map(hierarchy.materials.map((material) => [material.id, material]));
  const activeKeywordsByDocumentId = new Map(
    hierarchy.keywords
      .filter((keyword) => keyword.isActive)
      .map((keyword) => [`${keyword.materialId}:${keyword.docId}`, keyword] as const),
  );
  const representativeByKeywordId = new Map<string, RepresentativeOccurrence>();

  for (const chapter of selectedChapters) {
    const material = materialsById.get(chapter.materialId);
    const subject = material === undefined ? undefined : subjectsById.get(material.subjectId);
    if (material === undefined || subject === undefined) continue;

    const occurrences = keywordDocumentIds(chapter.body);
    occurrences.forEach((docId, bodyOccurrenceIndex) => {
      const keyword = activeKeywordsByDocumentId.get(`${chapter.materialId}:${docId}`);
      if (keyword === undefined) return;
      const occurrence: RepresentativeOccurrence = {
        chapterId: chapter.id,
        subjectOrder: subject.sortOrder,
        materialOrder: material.sortOrder,
        chapterOrder: chapter.sortOrder,
        bodyOccurrenceIndex,
      };
      const current = representativeByKeywordId.get(keyword.id);
      if (current === undefined || compareOccurrences(occurrence, current) < 0) {
        representativeByKeywordId.set(keyword.id, occurrence);
      }
    });
  }

  const statsByQuestionId = new Map(stats.map((item) => [item.questionId, item]));
  const seenQuestionIds = new Set<string>();
  return questions
    .filter((question) => {
      if (!question.isActive || seenQuestionIds.has(question.id)) return false;
      if (!representativeByKeywordId.has(question.keywordId)) return false;
      seenQuestionIds.add(question.id);
      return true;
    })
    .map((question): QuestionStudyCandidate => {
      const { chapterId, ...occurrence } = representativeByKeywordId.get(question.keywordId) as RepresentativeOccurrence;
      return {
        question,
        stats: statsByQuestionId.get(question.id) ?? null,
        ...occurrence,
        breadcrumb: buildBreadcrumb(hierarchy, question.keywordId, chapterId),
        keywordOrder: occurrence.bodyOccurrenceIndex,
        questionOrder: question.sortOrder,
      };
    })
    .sort(compareCandidatesByOccurrence);
}

function projectKeywordCandidates(
  keywordId: string,
  hierarchy: CatalogHierarchy,
  questions: readonly StructuredQuestion[],
  stats: readonly QuestionStudyStats[],
): readonly QuestionStudyCandidate[] {
  const keyword = hierarchy.keywords.find((item) => item.id === keywordId && item.isActive);
  if (keyword === undefined) return [];
  const material = hierarchy.materials.find((item) => item.id === keyword.materialId);
  const subject = material === undefined
    ? undefined
    : hierarchy.subjects.find((item) => item.id === material.subjectId);
  if (material === undefined || subject === undefined) return [];

  const statsByQuestionId = new Map(stats.map((item) => [item.questionId, item]));
  const seenQuestionIds = new Set<string>();
  return questions
    .filter((question) => {
      if (!question.isActive || question.keywordId !== keywordId || question.materialId !== material.id) {
        return false;
      }
      if (seenQuestionIds.has(question.id)) return false;
      seenQuestionIds.add(question.id);
      return true;
    })
    .map((question): QuestionStudyCandidate => ({
      question,
      stats: statsByQuestionId.get(question.id) ?? null,
      subjectOrder: subject.sortOrder,
      materialOrder: material.sortOrder,
      chapterOrder: null,
      bodyOccurrenceIndex: null,
      keywordOrder: 0,
      questionOrder: question.sortOrder,
      breadcrumb: buildBreadcrumb(hierarchy, keywordId, keyword.chapterId ?? null),
    }))
    .sort((left, right) => compareNumbers(left.questionOrder, right.questionOrder)
      || left.question.id.localeCompare(right.question.id));
}

/** 科目 / 教材 / 章（親から順） / キーワードの名前を並べる。名前の無い階層は省く。 */
function buildBreadcrumb(hierarchy: CatalogHierarchy, keywordId: string, chapterId: string | null): readonly string[] {
  const keyword = hierarchy.keywords.find((item) => item.id === keywordId);
  const material = hierarchy.materials.find((item) => item.id === keyword?.materialId);
  const subject = hierarchy.subjects.find((item) => item.id === material?.subjectId);
  const chaptersById = new Map(hierarchy.chapters.map((chapter) => [chapter.id, chapter]));
  const chain: string[] = [];
  const visited = new Set<string>();
  for (let id = chapterId; id !== null && id !== undefined && !visited.has(id);) {
    visited.add(id);
    const chapter = chaptersById.get(id);
    if (chapter === undefined) break;
    if (chapter.title) chain.unshift(chapter.title);
    id = chapter.parentId ?? null;
  }
  return [subject?.title, material?.title, ...chain, keyword?.answers?.[0]]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '');
}

function chaptersInScope(
  scope: Exclude<QuestionStudyScope, Readonly<{ kind: 'keyword'; id: string }>>,
  hierarchy: CatalogHierarchy,
): readonly CatalogHierarchy['chapters'][number][] | null {
  if (scope.kind === 'chapter') {
    const chapter = hierarchy.chapters.find((item) => item.id === scope.id);
    return chapter === undefined ? null : [chapter];
  }
  if (scope.kind === 'material') {
    if (!hierarchy.materials.some((item) => item.id === scope.id)) return null;
    return hierarchy.chapters.filter((chapter) => chapter.materialId === scope.id);
  }
  if (!hierarchy.subjects.some((item) => item.id === scope.id)) return null;
  const materialIds = new Set(
    hierarchy.materials.filter((material) => material.subjectId === scope.id).map((material) => material.id),
  );
  return hierarchy.chapters.filter((chapter) => materialIds.has(chapter.materialId));
}

function keywordDocumentIds(body: string): readonly string[] {
  const result: string[] = [];
  for (const token of scanKeywordTokens(body)) {
    const parsed = parseKeywordToken(token.inner);
    if (parsed?.docId !== null && parsed?.docId !== undefined) result.push(parsed.docId);
  }
  return result;
}

function compareOccurrences(left: RepresentativeOccurrence, right: RepresentativeOccurrence): number {
  return compareNumbers(left.subjectOrder, right.subjectOrder)
    || compareNumbers(left.materialOrder, right.materialOrder)
    || compareNumbers(left.chapterOrder, right.chapterOrder)
    || compareNumbers(left.bodyOccurrenceIndex, right.bodyOccurrenceIndex);
}

function compareCandidatesByOccurrence(left: QuestionStudyCandidate, right: QuestionStudyCandidate): number {
  return compareNumbers(left.subjectOrder, right.subjectOrder)
    || compareNumbers(left.materialOrder, right.materialOrder)
    || compareNumbers(left.chapterOrder ?? 0, right.chapterOrder ?? 0)
    || compareNumbers(left.bodyOccurrenceIndex ?? 0, right.bodyOccurrenceIndex ?? 0)
    || compareNumbers(left.questionOrder, right.questionOrder)
    || left.question.id.localeCompare(right.question.id);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
