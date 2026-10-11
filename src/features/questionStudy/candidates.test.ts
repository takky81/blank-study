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

  it('同一docIdが別教材の章に出現しても教材ごとのkeywordへ解決し、最小tupleで並べる', () => {
    const shared: CatalogHierarchy = {
      subjects: [{ id: 's2', sortOrder: 1 }, { id: 's1', sortOrder: 0 }],
      materials: [
        { id: 'm-late', subjectId: 's1', sortOrder: 5 },
        { id: 'm-early', subjectId: 's1', sortOrder: 2 },
      ],
      chapters: [
        { id: 'c-late', materialId: 'm-late', sortOrder: 0, body: '{{id=same01}}' },
        { id: 'c-early-2', materialId: 'm-early', sortOrder: 4, body: '{{id=same01}}' },
        { id: 'c-early-1', materialId: 'm-early', sortOrder: 3, body: 'x {{id=other2}} {{id=same01}}' },
      ],
      keywords: [
        { id: 'k-late', materialId: 'm-late', docId: 'same01', isActive: true },
        { id: 'k-early', materialId: 'm-early', docId: 'same01', isActive: true },
        { id: 'k-other', materialId: 'm-early', docId: 'other2', isActive: true },
      ],
    };
    const qs = [
      question('q-late', 'k-late', 0, { materialId: 'm-late' }),
      question('q-early', 'k-early', 0, { materialId: 'm-early' }),
      question('q-other', 'k-other', 0, { materialId: 'm-early' }),
    ];
    const result = projectQuestionCandidates({ kind: 'subject', id: 's1' }, shared, qs, []);

    expect(result.map(({ question: item }) => item.id)).toEqual(['q-other', 'q-early', 'q-late']);
    expect(result[1]).toMatchObject({ materialOrder: 2, chapterOrder: 3, bodyOccurrenceIndex: 1 });
    expect(result[2]).toMatchObject({ materialOrder: 5, chapterOrder: 0, bodyOccurrenceIndex: 0 });
  });

  it('同じ設問idの重複入力は最初の1件だけ残す', () => {
    const duplicated = [question('dup', 'keyword-a', 0), question('dup', 'keyword-a', 0)];
    expect(projectQuestionCandidates({ kind: 'chapter', id: 'chapter-first' }, hierarchy, duplicated, []))
      .toHaveLength(1);
    expect(projectQuestionCandidates({ kind: 'keyword', id: 'keyword-a' }, hierarchy, duplicated, []))
      .toHaveLength(1);
  });

  it('入力順を変えても同じ安定順になり、同じsortOrderはidで並ぶ', () => {
    const scope = { kind: 'material', id: 'material-a' } as const;
    const forward = projectQuestionCandidates(scope, hierarchy, questions, stats).map(({ question: q }) => q.id);
    const reversed = projectQuestionCandidates(scope, hierarchy, [...questions].reverse(), stats)
      .map(({ question: q }) => q.id);
    expect(reversed).toEqual(forward);
    expect(forward.indexOf('question-a1-a')).toBeLessThan(forward.indexOf('question-a1-z'));
  });

  it('設問なし・本文にkeywordなし・別教材のkeyword設問は空候補になる', () => {
    expect(projectQuestionCandidates({ kind: 'material', id: 'material-a' }, hierarchy, [], [])).toEqual([]);
    const noTokens = { ...hierarchy, chapters: hierarchy.chapters.map((c) => ({ ...c, body: '本文のみ' })) };
    expect(projectQuestionCandidates({ kind: 'subject', id: 'subject-a' }, noTokens, questions, [])).toEqual([]);
    expect(projectQuestionCandidates({ kind: 'subject', id: 'subject-b' }, hierarchy, questions, [])).toEqual([]);
    expect(projectQuestionCandidates(
      { kind: 'keyword', id: 'keyword-a' }, hierarchy,
      [question('foreign', 'keyword-a', 0, { materialId: 'material-b' })], [],
    )).toEqual([]);
  });
});
