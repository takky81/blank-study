import { scanKeywordTokens, parseKeywordToken } from '@/lib/keyword';
import type { StructuredQuestion } from '@/features/questions/types';

export type QuestionStudyScope =
  | Readonly<{ kind: 'subject'; id: string }>
  | Readonly<{ kind: 'material'; id: string }>
  | Readonly<{ kind: 'chapter'; id: string }>
  | Readonly<{ kind: 'keyword'; id: string }>;

export type CatalogHierarchy = Readonly<{
  subjects: readonly Readonly<{ id: string; sortOrder: number }>[];
  materials: readonly Readonly<{ id: string; subjectId: string; sortOrder: number }>[];
  chapters: readonly Readonly<{
    id: string;
    materialId: string;
    /** Catalog adapter が階層を安定した pre-order に展開した順序。 */
    sortOrder: number;
    body: string;
  }>[];
  keywords: readonly Readonly<{
    id: string;
    materialId: string;
    docId: string;
    isActive: boolean;
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
}>;

type RepresentativeOccurrence = Readonly<{
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
      const occurrence = representativeByKeywordId.get(question.keywordId) as RepresentativeOccurrence;
      return {
        question,
        stats: statsByQuestionId.get(question.id) ?? null,
        ...occurrence,
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
    }))
    .sort((left, right) => compareNumbers(left.questionOrder, right.questionOrder)
      || left.question.id.localeCompare(right.question.id));
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
