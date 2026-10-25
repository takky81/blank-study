import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Query = {
  table: string;
  eq: [string, unknown][];
  inFilter: [string, readonly unknown[]] | null;
  order: string[];
};

let tables: Record<string, Row[]> = {};
let failTable: string | null = null;
const queryLog: Query[] = [];

function evaluate(state: Query): Row[] {
  const rows = (tables[state.table] ?? []).filter((row) =>
    state.eq.every(([column, value]) => row[column] === value)
    && (state.inFilter === null || state.inFilter[1].includes(row[state.inFilter[0]])));
  return [...rows].sort((left, right) => {
    for (const column of state.order) {
      if (String(left[column]) !== String(right[column])) return String(left[column]) < String(right[column]) ? -1 : 1;
    }
    return 0;
  });
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const state: Query = { table, eq: [], inFilter: null, order: [] };
      queryLog.push(state);
      const error = () => (failTable === table ? { message: 'permission denied' } : null);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => { state.eq.push([column, value]); return query; }),
        in: vi.fn((column: string, values: readonly unknown[]) => { state.inFilter = [column, values]; return query; }),
        order: vi.fn((column: string) => { state.order.push(column); return query; }),
        range: vi.fn((from: number, to: number) => {
          const rows = evaluate(state);
          if (error()) return Promise.resolve({ data: null, count: null, error: error() });
          return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        }),
        maybeSingle: vi.fn(() => {
          const rows = evaluate(state);
          if (error()) return Promise.resolve({ data: null, error: error() });
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        }),
      };
      return query;
    }),
  },
}));

import { loadSubjectDistribution } from './distributionApi';
import { aggregateKeywordQuestionStudy } from './statsContract';

const ts = '2026-10-25T00:00:00.000Z';

function question(index: number, overrides: Row = {}): Row {
  return { id: `q-${String(index).padStart(5, '0')}`, material_id: 'm1', keyword_id: 'k1', is_active: true, ...overrides };
}

function stats(questionId: string, asked: number, correct: number): Row {
  return {
    question_id: questionId, asked_count: asked, correct_count: correct, consecutive_correct: 0,
    interval_days: 1, ease_factor: 2.5, due_at: ts, updated_at: ts,
  };
}

beforeEach(() => {
  tables = {
    subjects: [{ id: 's1', name: '情報' }, { id: 's2', name: '別科目' }],
    materials: [{ id: 'm1', subject_id: 's1' }, { id: 'm2', subject_id: 's1' }, { id: 'mx', subject_id: 's2' }],
    structured_questions: [],
    structured_question_stats: [],
    keyword_stats: [{ keyword_id: 'k1', asked_count: 99 }],
  };
  failTable = null;
  queryLog.length = 0;
});

describe('loadSubjectDistribution', () => {
  it('科目の有効設問だけを設問単位とkeyword単位の点にする', async () => {
    tables.structured_questions = [
      question(1), question(2, { keyword_id: 'k2', material_id: 'm2' }),
      question(3, { is_active: false }), question(4, { material_id: 'mx' }),
    ];
    tables.structured_question_stats = [stats('q-00001', 4, 3), stats('q-00003', 9, 9), stats('q-00004', 5, 5)];

    const result = await loadSubjectDistribution('s1');
    expect(result).toEqual({
      kind: 'found',
      subjectName: '情報',
      byQuestion: [{ askedCount: 4, correctCount: 3 }, { askedCount: 0, correctCount: 0 }],
      byKeyword: [{ askedCount: 4, correctCount: 3 }, { askedCount: 0, correctCount: 0 }],
    });
    expect(queryLog.some((query) => query.table === 'keyword_stats' || query.table === 'answer_logs')).toBe(false);
  });

  it('keyword単位の値はaggregateKeywordQuestionStudyと一致する', async () => {
    tables.structured_questions = [question(1), question(2), question(3, { keyword_id: 'k2' })];
    tables.structured_question_stats = [stats('q-00001', 2, 1), stats('q-00002', 3, 3), stats('q-00003', 1, 0)];
    const result = await loadSubjectDistribution('s1');
    const expected = aggregateKeywordQuestionStudy(
      [
        { id: 'q-00001', keywordId: 'k1', isActive: true },
        { id: 'q-00002', keywordId: 'k1', isActive: true },
        { id: 'q-00003', keywordId: 'k2', isActive: true },
      ],
      [
        { questionId: 'q-00001', askedCount: 2, correctCount: 1 },
        { questionId: 'q-00002', askedCount: 3, correctCount: 3 },
        { questionId: 'q-00003', askedCount: 1, correctCount: 0 },
      ],
    ).map((row) => ({ askedCount: row.attempts, correctCount: row.correct }));
    expect(result.kind === 'found' && result.byKeyword).toEqual(expected);
  });

  it('1,000件を超える設問も欠落・重複なく数える', async () => {
    tables.structured_questions = Array.from({ length: 2501 }, (_, index) => question(index));
    const result = await loadSubjectDistribution('s1');
    expect(result.kind === 'found' && result.byQuestion.length).toBe(2501);
  });

  it('科目が読めなければnot-foundを返す', async () => {
    await expect(loadSubjectDistribution('missing')).resolves.toEqual({ kind: 'not-found' });
  });

  it('読取失敗は操作文脈付きErrorにする', async () => {
    tables.structured_questions = [question(1)];
    failTable = 'structured_questions';
    await expect(loadSubjectDistribution('s1')).rejects.toThrow('成績分布を読み込めませんでした: permission denied');
  });
});
