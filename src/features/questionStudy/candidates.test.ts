import { describe, expect, it } from 'vitest';

import type { StructuredQuestion } from '@/features/questions/types';
import {
  projectQuestionCandidates,
  type CatalogHierarchy,
  type QuestionStudyStats,
} from './candidates';

const hierarchy: CatalogHierarchy = {
  subjects: [
    { id: 'subject-b', sortOrder: 1 },
    { id: 'subject-a', sortOrder: 0 },
  ],
  materials: [
    { id: 'material-b', subjectId: 'subject-a', sortOrder: 1 },
    { id: 'material-a', subjectId: 'subject-a', sortOrder: 0 },
  ],
  chapters: [
    { id: 'chapter-late', materialId: 'material-a', sortOrder: 2, body: '{{id=abc123}}' },
    {
      id: 'chapter-first',
      materialId: 'material-a',
      sortOrder: 1,
      body: '前 {{id=zzz999}} 中 {{id=abc123}} 後 {{id=abc123}}',
    },
    { id: 'chapter-other', materialId: 'material-b', sortOrder: 0, body: '{{id=other1}}' },
  ],
  keywords: [
    { id: 'keyword-a', materialId: 'material-a', docId: 'abc123', isActive: true },
    { id: 'keyword-z', materialId: 'material-a', docId: 'zzz999', isActive: true },
    { id: 'keyword-other', materialId: 'material-b', docId: 'other1', isActive: true },
    { id: 'keyword-inactive', materialId: 'material-a', docId: 'gone00', isActive: false },
  ],
};

function question(
  id: string,
  keywordId: string,
  sortOrder: number,
  overrides: Partial<StructuredQuestion> = {},
): StructuredQuestion {
  return {
    id,
    ownerId: 'owner-1',
    materialId: keywordId === 'keyword-other' ? 'material-b' : 'material-a',
    keywordId,
    questionText: `question ${id}`,
    modelAnswer: `answer ${id}`,
    choices: [],
    explanation: null,
    sortOrder,
    isActive: true,
    doubtFlag: false,
    explanationRequestFlag: false,
    version: 1,
    updatedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

const questions = [
  question('question-a2', 'keyword-a', 2),
  question('question-a1-z', 'keyword-a', 1),
  question('question-a1-a', 'keyword-a', 1),
  question('question-z', 'keyword-z', 0),
  question('question-other', 'keyword-other', 0),
  question('question-disabled', 'keyword-a', 0, { isActive: false }),
];

const stats: readonly QuestionStudyStats[] = [{
  questionId: 'question-a1-a',
  askedCount: 3,
  correctCount: 2,
  consecutiveCorrect: 1,
  intervalDays: 2,
  easeFactor: 2.5,
  dueAt: null,
  updatedAt: '2026-10-11T00:00:00.000Z',
}];

describe('projectQuestionCandidates', () => {
  it.each([
    [{ kind: 'subject', id: 'subject-a' } as const],
    [{ kind: 'material', id: 'material-a' } as const],
  ])('%o の本文出現を階層順に射影し、有効設問だけを一度ずつ返す', (scope) => {
    const result = projectQuestionCandidates(scope, hierarchy, questions, stats);

    expect(result.map(({ question: item }) => item.id)).toEqual([
      'question-z',
      'question-a1-a',
      'question-a1-z',
      'question-a2',
      ...(scope.kind === 'subject' ? ['question-other'] : []),
    ]);
    expect(result.find(({ question: item }) => item.id === 'question-a1-a')).toMatchObject({
      subjectOrder: 0,
      materialOrder: 0,
      chapterOrder: 1,
      bodyOccurrenceIndex: 1,
      keywordOrder: 1,
      questionOrder: 1,
      stats: { askedCount: 3 },
    });
    expect(result.filter(({ question: item }) => item.id === 'question-a1-a')).toHaveLength(1);
    expect(result.some(({ question: item }) => item.id === 'question-disabled')).toBe(false);
  });

  it('章scopeでは選択章本文の全出現中の最初を代表位置にする', () => {
    const result = projectQuestionCandidates(
      { kind: 'chapter', id: 'chapter-first' },
      hierarchy,
      questions,
      [],
    );

    expect(result.map(({ question: item }) => item.id)).toEqual([
      'question-z', 'question-a1-a', 'question-a1-z', 'question-a2',
    ]);
    expect(result.at(1)).toMatchObject({ bodyOccurrenceIndex: 1, keywordOrder: 1, stats: null });
  });

  it('keyword直接scopeは本文出現を参照せず(sortOrder,id)だけで並べる', () => {
    const withoutOccurrences = { ...hierarchy, chapters: [] };
    const result = projectQuestionCandidates(
      { kind: 'keyword', id: 'keyword-a' },
      withoutOccurrences,
      questions,
      stats,
    );

    expect(result.map(({ question: item }) => item.id)).toEqual([
      'question-a1-a', 'question-a1-z', 'question-a2',
    ]);
    expect(result.every((item) => item.chapterOrder === null && item.bodyOccurrenceIndex === null)).toBe(true);
  });

  it.each([
    { kind: 'subject', id: 'missing' } as const,
    { kind: 'material', id: 'missing' } as const,
    { kind: 'chapter', id: 'missing' } as const,
    { kind: 'keyword', id: 'missing' } as const,
    { kind: 'keyword', id: 'keyword-inactive' } as const,
  ])('空・not-found・forbidden相当を安全な空結果へ畳む: %o', (scope) => {
    expect(projectQuestionCandidates(scope, hierarchy, questions, stats)).toEqual([]);
  });

  it('入力配列を変更しない', () => {
    const before = questions.map(({ id }) => id);
    projectQuestionCandidates({ kind: 'material', id: 'material-a' }, hierarchy, questions, stats);
    expect(questions.map(({ id }) => id)).toEqual(before);
  });
});
