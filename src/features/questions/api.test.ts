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
let rpcResults: { data: unknown; error: unknown; after?: () => void }[] = [];
const rpcLog: { name: string; args: Record<string, unknown> }[] = [];
const queryLog: { filter: [string, string] | null; order: string[]; ranges: [number, number][] }[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcLog.push({ name, args });
      const result = rpcResults.shift() ?? { data: null, error: null };
      result.after?.();
      return Promise.resolve(result);
    }),
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

import {
  deleteQuestion,
  listQuestionsByKeyword,
  listQuestionsByMaterial,
  mapStructuredQuestionRow,
  reorderQuestions,
  saveQuestion,
  setQuestionActive,
  setQuestionFlags,
} from './api';

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
  rpcResults = [];
  rpcLog.length = 0;
});

describe('structured question mutation API', () => {
  const savedRow = row(1, { version: 4, doubt_flag: true });
  const currentRow = row(1, { version: 5, question_text: '現在の設問' });
  const draft = {
    keywordId: 'keyword-1', questionText: ' 設問 ', modelAnswer: '答え',
    choices: ['誤答1', '誤答2'], explanation: null,
  };

  it('作成と内容保存を同じcommand RPCへ正確な引数で接続する', async () => {
    rpcResults.push(
      { data: { kind: 'saved', question: savedRow }, error: null },
      { data: { kind: 'saved', question: { ...savedRow, version: 5 } }, error: null },
    );
    await expect(saveQuestion(draft)).resolves.toMatchObject({ kind: 'saved', question: { version: 4 } });
    await expect(saveQuestion(draft, 'question-0001', 4)).resolves.toMatchObject({ kind: 'saved', question: { version: 5 } });
    expect(rpcLog).toEqual([
      { name: 'mutate_structured_question', args: {
        p_command: 'create', p_question_id: null, p_keyword_id: 'keyword-1', p_expected_version: null,
        p_content: { question_text: ' 設問 ', model_answer: '答え', choices: ['誤答1', '誤答2'], explanation: null },
        p_flag_patch: null,
      } },
      { name: 'mutate_structured_question', args: {
        p_command: 'update-content', p_question_id: 'question-0001', p_keyword_id: null, p_expected_version: 4,
        p_content: { question_text: ' 設問 ', model_answer: '答え', choices: ['誤答1', '誤答2'], explanation: null },
        p_flag_patch: null,
      } },
    ]);
  });

  it('flagとactiveを独立patchとして送り、競合では現在行を保持する', async () => {
    rpcResults.push(
      { data: { kind: 'saved', question: savedRow }, error: null },
      { data: { kind: 'version-conflict', current: currentRow }, error: null },
    );
    await expect(setQuestionFlags('question-0001', 3, { doubtFlag: true })).resolves.toMatchObject({ kind: 'saved' });
    await expect(setQuestionActive('question-0001', 4, false)).resolves.toEqual({
      kind: 'version-conflict', current: mapStructuredQuestionRow(currentRow),
    });
    expect(rpcLog.map(({ args }) => [args.p_command, args.p_flag_patch])).toEqual([
      ['set-flags', { doubt_flag: true }], ['set-active', { is_active: false }],
    ]);
  });

  it('並べ替えの確定順と版、および競合の現在版を返す', async () => {
    const reordered = [row(2, { sort_order: 0, version: 3 }), row(1, { sort_order: 1, version: 7 })];
    rpcResults.push(
      { data: { kind: 'saved', questions: reordered }, error: null },
      { data: { kind: 'version-conflict', current: currentRow }, error: null },
    );
    await expect(reorderQuestions('keyword-1', [
      { id: 'question-0002', version: 2, updatedAt: 'old' },
      { id: 'question-0001', version: 6, updatedAt: 'old' },
    ])).resolves.toEqual(reordered.map(mapStructuredQuestionRow));
    await expect(reorderQuestions('keyword-1', [])).resolves.toEqual({
      kind: 'version-conflict', current: mapStructuredQuestionRow(currentRow),
    });
    expect(rpcLog[0]).toEqual({ name: 'reorder_structured_questions', args: {
      p_keyword_id: 'keyword-1',
      p_ordered: [{ id: 'question-0002', version: 2 }, { id: 'question-0001', version: 6 }],
    } });
  });

  it('削除結果と競合を判別する', async () => {
    rpcResults.push(
      { data: { kind: 'deleted', id: 'question-0001', version: 3 }, error: null },
      { data: { kind: 'version-conflict', current: currentRow }, error: null },
    );
    await expect(deleteQuestion('question-0001', 3)).resolves.toBe('deleted');
    await expect(deleteQuestion('question-0001', 3)).resolves.toEqual({
      kind: 'version-conflict', current: mapStructuredQuestionRow(currentRow),
    });
  });

  it('各mutation後の再取得が確定内容・順序・flag・版を返す', async () => {
    const created = row(1, { question_text: '作成済み', version: 1 });
    const flagged = { ...created, doubt_flag: true, explanation_request_flag: true, version: 2 };
    const inactive = { ...flagged, is_active: false, version: 3 };
    const second = row(2, { sort_order: 0, version: 2 });
    const reordered = { ...inactive, sort_order: 1, version: 4 };
    rpcResults.push(
      { data: { kind: 'saved', question: created }, error: null, after: () => { sourceRows = [created]; } },
      { data: { kind: 'saved', question: flagged }, error: null, after: () => { sourceRows = [flagged]; } },
      { data: { kind: 'saved', question: inactive }, error: null, after: () => { sourceRows = [inactive]; } },
      { data: { kind: 'saved', questions: [second, reordered] }, error: null, after: () => { sourceRows = [reordered, second]; } },
      { data: { kind: 'deleted', id: created.id, version: 4 }, error: null, after: () => { sourceRows = [second]; } },
    );
    await saveQuestion(draft);
    expect((await listQuestionsByKeyword('keyword-1'))[0]).toMatchObject({ questionText: '作成済み', version: 1 });
    await setQuestionFlags(created.id, 1, { doubtFlag: true, explanationRequestFlag: true });
    expect((await listQuestionsByKeyword('keyword-1'))[0]).toMatchObject({ doubtFlag: true, explanationRequestFlag: true, version: 2 });
    await setQuestionActive(created.id, 2, false);
    expect((await listQuestionsByKeyword('keyword-1'))[0]).toMatchObject({ isActive: false, version: 3 });
    await reorderQuestions('keyword-1', [
      { id: second.id, version: 1, updatedAt: second.updated_at },
      { id: created.id, version: 3, updatedAt: inactive.updated_at },
    ]);
    expect((await listQuestionsByKeyword('keyword-1')).map(({ id, sortOrder, version }) => ({ id, sortOrder, version }))).toEqual([
      { id: second.id, sortOrder: 0, version: 2 },
      { id: created.id, sortOrder: 1, version: 4 },
    ]);
    await deleteQuestion(created.id, 4);
    expect((await listQuestionsByKeyword('keyword-1')).map(({ id }) => id)).toEqual([second.id]);
  });

  it.each([
    ['保存', () => saveQuestion(draft)],
    ['フラグ更新', () => setQuestionFlags('question-0001', 1, { explanationRequestFlag: true })],
    ['有効状態更新', () => setQuestionActive('question-0001', 1, false)],
    ['並べ替え', () => reorderQuestions('keyword-1', [])],
    ['削除', () => deleteQuestion('question-0001', 1)],
  ])('%sのDB失敗を操作文脈付きErrorへ変換してcauseを保持する', async (operation, invoke) => {
    const cause = { message: 'db unavailable', code: 'XX000' };
    rpcResults.push({ data: null, error: cause });
    await expect(invoke()).rejects.toMatchObject({ message: `設問の${operation}に失敗しました`, cause });
  });

  it('未知・不正なRPC payloadを信頼せず内容を漏らさないErrorにする', async () => {
    rpcResults.push({ data: { kind: 'saved', question: { ...savedRow, choices: [1] } }, error: null });
    const error = await saveQuestion(draft).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: '設問の保存に失敗しました' });
    expect(String(error)).not.toContain('question-0001');
  });

  it.each([
    ['保存', () => saveQuestion(draft), null],
    ['保存', () => saveQuestion(draft), []],
    ['保存', () => saveQuestion(draft), { kind: 'unknown' }],
    ['保存', () => saveQuestion(draft), { kind: 'saved' }],
    ['フラグ更新', () => setQuestionFlags('question-0001', 1, { doubtFlag: true }), { kind: 'saved', question: null }],
    ['有効状態更新', () => setQuestionActive('question-0001', 1, false), { kind: 'version-conflict' }],
    ['有効状態更新', () => setQuestionActive('question-0001', 1, false), { kind: 'version-conflict', current: [] }],
    ['並べ替え', () => reorderQuestions('keyword-1', []), null],
    ['並べ替え', () => reorderQuestions('keyword-1', []), []],
    ['並べ替え', () => reorderQuestions('keyword-1', []), { kind: 'unknown' }],
    ['並べ替え', () => reorderQuestions('keyword-1', []), { kind: 'saved' }],
    ['並べ替え', () => reorderQuestions('keyword-1', []), { kind: 'saved', questions: [null] }],
    ['削除', () => deleteQuestion('question-0001', 3), null],
    ['削除', () => deleteQuestion('question-0001', 3), []],
    ['削除', () => deleteQuestion('question-0001', 3), { kind: 'unknown' }],
    ['削除', () => deleteQuestion('question-0001', 3), { kind: 'deleted' }],
    ['削除', () => deleteQuestion('question-0001', 3), { kind: 'deleted', id: 'other-question', version: 3 }],
    ['削除', () => deleteQuestion('question-0001', 3), { kind: 'deleted', id: 'question-0001', version: 0 }],
    ['削除', () => deleteQuestion('question-0001', 3), { kind: 'deleted', id: 'question-0001', version: 1.5 }],
    ['削除', () => deleteQuestion('question-0001', 3), { kind: 'deleted', id: 'question-0001', version: 4 }],
    ['削除', () => deleteQuestion('question-0001', 3), { kind: 'version-conflict', current: null }],
  ] as const)('%sでmalformed RPC payloadを操作文脈付きErrorにする %#', async (operation, invoke, data) => {
    rpcResults.push({ data, error: null });
    await expect(invoke()).rejects.toMatchObject({ message: `設問の${operation}に失敗しました` });
  });
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
