import { beforeEach, describe, expect, it, vi } from 'vitest';

type DbRow = {
  id: string;
  owner_id: string;
  material_id: string;
  keyword_id: string;
  question_text: string;
  model_answer: string;
  choices: string[];
  explanation: string | null;
  sort_order: number;
  is_active: boolean;
  doubt_flag: boolean;
  explanation_request_flag: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

let sourceRows: DbRow[] = [];
const queryLog: { filter: [string, string] | null; order: string[]; ranges: [number, number][] }[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const state = { filter: null as [string, string] | null, order: [] as string[], ranges: [] as [number, number][] };
      queryLog.push(state);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => {
          state.filter = [column, value];
          return query;
        }),
        order: vi.fn((column: string) => {
          state.order.push(column);
          return query;
        }),
        range: vi.fn((from: number, to: number) => {
          state.ranges.push([from, to]);
          const filtered = state.filter
            ? sourceRows.filter((row) => String(row[state.filter?.[0] as keyof DbRow]) === state.filter?.[1])
            : sourceRows;
          const sorted = [...filtered].sort((left, right) => {
            for (const column of state.order) {
              const a = left[column as keyof DbRow];
              const b = right[column as keyof DbRow];
              if (typeof a === 'number' && typeof b === 'number' && a !== b) return a - b;
              const textA = String(a);
              const textB = String(b);
              if (textA !== textB) return textA.localeCompare(textB);
            }
            return 0;
          });
          return Promise.resolve({ data: sorted.slice(from, to + 1), count: sorted.length, error: null });
        }),
      };
      return query;
    }),
  },
}));

import { listQuestionsByKeyword, listQuestionsByMaterial, mapStructuredQuestionRow } from './api';

function row(index: number, overrides: Partial<DbRow> = {}): DbRow {
  return {
    id: `question-${String(index).padStart(4, '0')}`,
    owner_id: 'owner-1',
    material_id: 'material-1',
    keyword_id: 'keyword-1',
    question_text: `question ${index}`,
    model_answer: `answer ${index}`,
    choices: ['A', 'B'],
    explanation: null,
    sort_order: index,
    is_active: true,
    doubt_flag: false,
    explanation_request_flag: false,
    version: 1,
    created_at: '2026-10-10T00:00:00.000Z',
    updated_at: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  sourceRows = [];
  queryLog.length = 0;
});

describe('structured question read API', () => {
  it('DB rowをcamelCase公開型へnull・flag・版・更新時刻を保って変換する', () => {
    expect(mapStructuredQuestionRow(row(1, { explanation: '説明', is_active: false, doubt_flag: true, explanation_request_flag: true, version: 7 }))).toEqual({
      id: 'question-0001', ownerId: 'owner-1', materialId: 'material-1', keywordId: 'keyword-1',
      questionText: 'question 1', modelAnswer: 'answer 1', choices: ['A', 'B'], explanation: '説明',
      sortOrder: 1, isActive: false, doubtFlag: true, explanationRequestFlag: true,
      version: 7, updatedAt: '2026-10-11T00:00:00.000Z',
    });
  });

  it('keywordを(sort_order,id)でページングし1001件を欠落・重複なく返す', async () => {
    sourceRows = Array.from({ length: 1001 }, (_, index) =>
      row(index, { sort_order: index < 998 ? 2 : 10 }),
    ).reverse();
    const result = await listQuestionsByKeyword('keyword-1');
    expect(result).toHaveLength(1001);
    expect(new Set(result.map(({ id }) => id)).size).toBe(1001);
    expect(result.map(({ sortOrder, id }) => [sortOrder, id])).toEqual(
      Array.from({ length: 1001 }, (_, index) => [
        index < 998 ? 2 : 10,
        `question-${String(index).padStart(4, '0')}`,
      ]),
    );
    expect(result.slice(998).map(({ sortOrder }) => sortOrder)).toEqual([10, 10, 10]);
    expect(queryLog.map(({ order }) => order)).toEqual([['sort_order', 'id'], ['sort_order', 'id']]);
    expect(queryLog.map(({ ranges }) => ranges[0])).toEqual([[0, 999], [1000, 1999]]);
  });

  it('materialを(keyword_id,sort_order,id)で1001件ページングし欠落・重複なく返す', async () => {
    sourceRows = Array.from({ length: 1001 }, (_, index) =>
      row(index, { keyword_id: index < 999 ? 'keyword-a' : 'keyword-b', sort_order: 3 }),
    ).reverse();
    const result = await listQuestionsByMaterial('material-1');
    expect(result).toHaveLength(1001);
    expect(new Set(result.map(({ id }) => id)).size).toBe(1001);
    expect(result.map(({ keywordId, sortOrder, id }) => [keywordId, sortOrder, id])).toEqual(
      Array.from({ length: 1001 }, (_, index) => [
        index < 999 ? 'keyword-a' : 'keyword-b',
        3,
        `question-${String(index).padStart(4, '0')}`,
      ]),
    );
    expect(result.slice(999).map(({ keywordId, sortOrder }) => [keywordId, sortOrder])).toEqual([
      ['keyword-b', 3],
      ['keyword-b', 3],
    ]);
    expect(queryLog.map(({ order }) => order)).toEqual([
      ['keyword_id', 'sort_order', 'id'],
      ['keyword_id', 'sort_order', 'id'],
    ]);
    expect(queryLog.map(({ filter }) => filter)).toEqual([
      ['material_id', 'material-1'],
      ['material_id', 'material-1'],
    ]);
    expect(queryLog.map(({ ranges }) => ranges[0])).toEqual([[0, 999], [1000, 1999]]);
  });

  it('存在しないkeywordとRLSで非表示のkeywordを同じ空配列として扱う', async () => {
    sourceRows = [row(1, { keyword_id: 'authorized-keyword' })];
    expect(await listQuestionsByKeyword('missing-or-hidden')).toEqual([]);
  });
});
