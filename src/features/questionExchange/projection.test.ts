import { describe, expect, it } from 'vitest';
import type { StructuredQuestion } from '@/features/questions/types';
import golden from './fixtures/question-exchange-v1.export.json';
import { projectEligibilityExport, type ExchangeCatalog } from './projection';
import type { EligibilityTarget, QuestionExchangeExportV1 } from './types';

const fixture = golden as QuestionExchangeExportV1;
const header = { schemaVersion: 1 as const, exchangeId: fixture.exchangeId, exportedAt: fixture.exportedAt };

const SUBJECT = '20000000-0000-4000-8000-000000000001';
const MATERIAL = '30000000-0000-4000-8000-000000000001';
const OTHER_MATERIAL = '30000000-0000-4000-8000-000000000009';
const KW1 = '10000000-0000-4000-8000-000000000001';
const KW2 = '10000000-0000-4000-8000-000000000002';
const ctx = fixture.targets[0]!.chapterContexts;

const catalog: ExchangeCatalog = {
  subjects: [{ id: SUBJECT, title: '生物', sortOrder: 0 }],
  materials: [
    { id: OTHER_MATERIAL, subjectId: SUBJECT, title: '別教材', sortOrder: 5 },
    { id: MATERIAL, subjectId: SUBJECT, title: '基礎生物', sortOrder: 0 },
  ],
  chapters: [
    // 入力順は階層順と無関係。pre-order順は 序章(0) → 代謝(1) → エネルギー(2, 代謝の子)。
    { id: ctx[1]!.chapter.id, materialId: MATERIAL, parentId: ctx[0]!.chapter.id, title: 'エネルギー', sortOrder: 0, body: ctx[1]!.chapter.bodyMarkdown },
    { id: ctx[0]!.chapter.id, materialId: MATERIAL, parentId: null, title: '代謝', sortOrder: 1, body: ctx[0]!.chapter.bodyMarkdown },
    // provenance chapterだが本文に出現しない章は含めない。
    { id: '40000000-0000-4000-8000-000000000000', materialId: MATERIAL, parentId: null, title: '序章', sortOrder: 0, body: '序文{{細胞|id=zz99zz}}' },
    // 別教材の同じdoc IDは別keywordであり、membershipに含めない。
    { id: '40000000-0000-4000-8000-000000000009', materialId: OTHER_MATERIAL, parentId: null, title: '別章', sortOrder: 0, body: '{{光合成|id=ab12cd}}' },
  ],
  keywords: [
    { id: KW1, materialId: MATERIAL, docId: 'ab12cd', answers: ['光合成', '炭酸同化'], isActive: true },
    { id: KW2, materialId: MATERIAL, docId: 'ef34gh', answers: ['呼吸'], isActive: true },
    { id: '10000000-0000-4000-8000-000000000009', materialId: MATERIAL, docId: 'zz99zz', answers: ['細胞'], isActive: true },
  ],
};

function toQuestion(keywordId: string, q: QuestionExchangeExportV1['targets'][number]['questions'][number]): StructuredQuestion {
  return {
    id: q.questionId,
    version: q.expectedVersion,
    updatedAt: '2026-10-01T00:00:00Z',
    ownerId: 'owner',
    materialId: MATERIAL,
    keywordId,
    questionText: q.questionText,
    modelAnswer: q.modelAnswer,
    choices: q.choices,
    explanation: q.explanation,
    sortOrder: q.sortOrder,
    isActive: true,
    doubtFlag: q.requestedFlags.includes('doubt'),
    doubtNote: q.doubtNote,
    explanationRequestFlag: q.requestedFlags.includes('explanation-request'),
  };
}

const activeQuestions = fixture.targets.flatMap((t) => t.questions.map((q) => toQuestion(t.keyword.id, q)));
const inactive: StructuredQuestion = { ...activeQuestions[1]!, id: '50000000-0000-4000-8000-0000000000ff', isActive: false };

function eligibilityOf(index: number): EligibilityTarget {
  const t = fixture.targets[index]!;
  return {
    keywordId: t.keyword.id,
    metrics: t.metrics,
    reasons: [...t.reasons].reverse(),
    flaggedQuestions: [...t.flaggedQuestions].reverse().map((f) => ({ ...f, requestKinds: [...f.requestKinds].reverse() })),
  };
}

describe('eligibility結果のexport projection', () => {
  it('階層・本文・設問版を接続し、golden fixtureと完全一致する', () => {
    const result = projectEligibilityExport({
      header,
      filters: fixture.filters,
      targets: [eligibilityOf(1), eligibilityOf(0)],
      catalog,
      questions: [...activeQuestions].reverse().concat(inactive),
    });
    expect(result).toEqual(fixture);
  });

  it('同一keywordの複数章・同一章内の複数出現でもtargetは1件で、章contextは重複しない', () => {
    const result = projectEligibilityExport({
      header,
      filters: fixture.filters,
      targets: [eligibilityOf(0)],
      catalog,
      questions: activeQuestions,
    });
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]!.chapterContexts.map((c) => c.chapter.id)).toEqual(ctx.map((c) => c.chapter.id));
  });

  it('無効設問と他keywordの設問をquestionsへ含めない', () => {
    const result = projectEligibilityExport({
      header,
      filters: fixture.filters,
      targets: [eligibilityOf(1)],
      catalog,
      questions: [...activeQuestions, inactive],
    });
    expect(result.targets[0]!.questions.map((q) => q.questionId)).toEqual(['50000000-0000-4000-8000-000000000004']);
  });

  it('catalogに存在しないkeywordのtargetは不完全なartifactとして拒否する', () => {
    expect(() =>
      projectEligibilityExport({
        header,
        filters: fixture.filters,
        targets: [eligibilityOf(0)],
        catalog: { ...catalog, keywords: catalog.keywords.slice(1) },
        questions: activeQuestions,
      }),
    ).toThrow();
  });

  it('階層が欠けた章は不完全なartifactとして拒否する', () => {
    expect(() =>
      projectEligibilityExport({
        header,
        filters: fixture.filters,
        targets: [eligibilityOf(0)],
        catalog: { ...catalog, subjects: [] },
        questions: activeQuestions,
      }),
    ).toThrow();
  });
});
