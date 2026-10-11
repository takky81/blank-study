import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Query = {
  table: string;
  eq: [string, unknown][];
  inFilter: [string, readonly unknown[]] | null;
  order: string[];
  ranges: [number, number][];
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
      const a = left[column];
      const b = right[column];
      if (typeof a === 'number' && typeof b === 'number' && a !== b) return a - b;
      if (String(a) !== String(b)) return String(a) < String(b) ? -1 : 1;
    }
    return 0;
  });
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const state: Query = { table, eq: [], inFilter: null, order: [], ranges: [] };
      queryLog.push(state);
      const error = () => (failTable === table ? { message: 'permission denied' } : null);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => { state.eq.push([column, value]); return query; }),
        in: vi.fn((column: string, values: readonly unknown[]) => { state.inFilter = [column, values]; return query; }),
        order: vi.fn((column: string) => { state.order.push(column); return query; }),
        range: vi.fn((from: number, to: number) => {
          state.ranges.push([from, to]);
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

import { listQuestionStudyStats, loadQuestionStudyCandidates } from './api';

const ts = '2026-10-11T00:00:00.000Z';

function questionRow(index: number, overrides: Row = {}): Row {
  return {
    id: `q-${String(index).padStart(5, '0')}`,
    owner_id: 'owner-1', material_id: 'm1', keyword_id: 'k1',
    question_text: `問${index}`, model_answer: `答${index}`, choices: [], explanation: null,
    sort_order: index, is_active: true, doubt_flag: false, explanation_request_flag: false,
    version: 1, created_at: ts, updated_at: ts, ...overrides,
  };
}

function statsRow(questionId: string, overrides: Row = {}): Row {
  return {
    question_id: questionId, owner_id: 'owner-1', asked_count: 3, correct_count: 2,
    consecutive_correct: 1, interval_days: 4, ease_factor: 2.36, due_at: ts, updated_at: ts, ...overrides,
  };
}

function seedCatalog(): void {
  tables = {
    subjects: [{ id: 's1', sort_order: 0 }],
    materials: [
      { id: 'm1', subject_id: 's1', sort_order: 1 },
      { id: 'm0', subject_id: 's1', sort_order: 0 },
    ],
    chapters: [
      { id: 'c-child', material_id: 'm1', parent_id: 'c-root', sort_order: 0, body: '{{id=bbb222}}' },
      { id: 'c-root', material_id: 'm1', parent_id: null, sort_order: 0, body: '本文 {{id=aaa111}}' },
      { id: 'c-second', material_id: 'm1', parent_id: null, sort_order: 1, body: '{{id=bbb222}}' },
      { id: 'c-m0', material_id: 'm0', parent_id: null, sort_order: 0, body: '{{id=ccc000}}' },
    ],
    keywords: [
      { id: 'k1', material_id: 'm1', doc_id: 'aaa111', is_active: true },
      { id: 'k2', material_id: 'm1', doc_id: 'bbb222', is_active: true },
      { id: 'k0', material_id: 'm0', doc_id: 'ccc000', is_active: true },
    ],
    structured_questions: [],
    structured_question_stats: [],
  };
}

beforeEach(() => {
  seedCatalog();
  failTable = null;
  queryLog.length = 0;
});

describe('listQuestionStudyStats', () => {
  it('DB行をcamelCaseのstatsへ変換する', async () => {
    tables.structured_question_stats = [statsRow('q-1', { ease_factor: '2.36' })];
    await expect(listQuestionStudyStats(['q-1'])).resolves.toEqual([{
      questionId: 'q-1', askedCount: 3, correctCount: 2, consecutiveCorrect: 1,
      intervalDays: 4, easeFactor: 2.36, dueAt: ts, updatedAt: ts,
    }]);
  });

  it('1,001件以上のIDでも分割と全ページ取得で欠落・重複なく返す', async () => {
    const ids = Array.from({ length: 2501 }, (_, index) => `q-${String(index).padStart(5, '0')}`);
    tables.structured_question_stats = ids.map((id) => statsRow(id));
    const result = await listQuestionStudyStats([...ids, ids[0] as string]);
    expect(result.map((item) => item.questionId)).toEqual(ids);
    const statsQueries = queryLog.filter((query) => query.table === 'structured_question_stats');
    expect(statsQueries.every((query) => query.order.at(-1) === 'question_id')).toBe(true);
    expect(statsQueries.every((query) => (query.inFilter?.[1].length ?? 0) <= 1000)).toBe(true);
  });

  it('空のID列ではDBを呼ばない', async () => {
    await expect(listQuestionStudyStats([])).resolves.toEqual([]);
    expect(queryLog).toHaveLength(0);
  });

  it('読取失敗は操作文脈付き日本語Errorにする', async () => {
    failTable = 'structured_question_stats';
    await expect(listQuestionStudyStats(['q-1'])).rejects.toThrow('設問学習の統計を読み込めませんでした');
  });
});

describe('loadQuestionStudyCandidates', () => {
  it('階層をpre-orderで展開し、本文出現順で候補を射影する', async () => {
    tables.structured_questions = [
      questionRow(1, { keyword_id: 'k2' }),
      questionRow(2, { keyword_id: 'k1' }),
      questionRow(3, { keyword_id: 'k0', material_id: 'm0' }),
    ];
    tables.structured_question_stats = [statsRow('q-00002')];
    const result = await loadQuestionStudyCandidates({ kind: 'subject', id: 's1' });
    expect(result.map((candidate) => candidate.question.id)).toEqual(['q-00003', 'q-00002', 'q-00001']);
    expect(result[1]).toMatchObject({ chapterOrder: 0, stats: { questionId: 'q-00002', askedCount: 3 } });
    // c-child は c-root の子なので pre-order で 1 番目、c-second は 2 番目
    expect(result[2]).toMatchObject({ chapterOrder: 1, bodyOccurrenceIndex: 0, stats: null });
  });

  it('章とkeywordのscopeを解決する', async () => {
    tables.structured_questions = [questionRow(1, { keyword_id: 'k2' }), questionRow(2, { keyword_id: 'k1' })];
    const chapter = await loadQuestionStudyCandidates({ kind: 'chapter', id: 'c-second' });
    expect(chapter.map((candidate) => candidate.question.id)).toEqual(['q-00001']);
    const keyword = await loadQuestionStudyCandidates({ kind: 'keyword', id: 'k1' });
    expect(keyword.map((candidate) => candidate.question.id)).toEqual(['q-00002']);
  });

  it('1,001件以上の設問とstatsを欠落・重複なく候補へ渡す', async () => {
    tables.structured_questions = Array.from({ length: 1501 }, (_, index) => questionRow(index));
    tables.structured_question_stats = tables.structured_questions.map((row) => statsRow(row.id as string));
    const result = await loadQuestionStudyCandidates({ kind: 'material', id: 'm1' });
    expect(result).toHaveLength(1501);
    expect(new Set(result.map((candidate) => candidate.question.id)).size).toBe(1501);
    expect(result.every((candidate) => candidate.stats !== null)).toBe(true);
  });

  it('存在しない・権限外のscopeは内容を漏らさず空にする', async () => {
    tables.structured_questions = [questionRow(1)];
    await expect(loadQuestionStudyCandidates({ kind: 'material', id: 'other' })).resolves.toEqual([]);
    await expect(loadQuestionStudyCandidates({ kind: 'subject', id: 'other' })).resolves.toEqual([]);
    await expect(loadQuestionStudyCandidates({ kind: 'chapter', id: 'other' })).resolves.toEqual([]);
    await expect(loadQuestionStudyCandidates({ kind: 'keyword', id: 'other' })).resolves.toEqual([]);
    expect(queryLog.some((query) => query.table === 'structured_questions')).toBe(false);
  });

  it('階層読取の失敗は操作文脈付き日本語Errorにする', async () => {
    failTable = 'chapters';
    await expect(loadQuestionStudyCandidates({ kind: 'material', id: 'm1' }))
      .rejects.toThrow(/^設問学習の候補を読み込めませんでした: /);
  });

  it('設問読取の失敗も操作文脈付き日本語Errorにする', async () => {
    failTable = 'structured_questions';
    await expect(loadQuestionStudyCandidates({ kind: 'material', id: 'm1' }))
      .rejects.toThrow(/^設問学習の候補を読み込めませんでした: /);
  });
});
