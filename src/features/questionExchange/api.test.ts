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
let failFromOffset = 0;
const queryLog: Query[] = [];
let rpcImpl: () => Promise<{ data: unknown; error: unknown }> = () => Promise.resolve({ data: [], error: null });
const rpcCalls: [string, Record<string, unknown>][] = [];

function evaluate(state: Query): Row[] {
  const rows = (tables[state.table] ?? []).filter((row) =>
    state.eq.every(([c, v]) => row[c] === v)
    && (state.inFilter === null || state.inFilter[1].includes(row[state.inFilter[0]])));
  return [...rows].sort((l, r) => {
    for (const c of state.order) {
      const a = l[c];
      const b = r[c];
      if (typeof a === 'number' && typeof b === 'number' && a !== b) return a - b;
      if (String(a) !== String(b)) return String(a) < String(b) ? -1 : 1;
    }
    return 0;
  });
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return rpcImpl();
    }),
    from: vi.fn((table: string) => {
      const state: Query = { table, eq: [], inFilter: null, order: [], ranges: [] };
      queryLog.push(state);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((c: string, v: unknown) => { state.eq.push([c, v]); return query; }),
        in: vi.fn((c: string, v: readonly unknown[]) => { state.inFilter = [c, v]; return query; }),
        order: vi.fn((c: string) => { state.order.push(c); return query; }),
        range: vi.fn((from: number, to: number) => {
          state.ranges.push([from, to]);
          if (failTable === table && from >= failFromOffset) {
            return Promise.resolve({ data: null, count: null, error: { message: 'network down' } });
          }
          const rows = evaluate(state);
          return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        }),
      };
      return query;
    }),
  },
}));

import { buildImportPreview, commitQuestionExchange, exportEligibleQuestions, mapEligibilityRpcResult } from './api';
import { parseExchangeExport, serializeExchangeExport } from './schema';

const uuid = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KW1 = uuid(1);
const KWX = uuid(2);
const Q1 = uuid(3);
const Q2 = uuid(4);
const EX1 = uuid(5);
const S1 = uuid(6);
const M1 = uuid(7);
const C1 = uuid(8);
const C2 = uuid(9);
const ts = '2026-10-11T00:00:00.000Z';
const filter = { minimumAttempts: 3, maximumAccuracy: 0.5, maximumQuestionCount: 2 };
const deps = { createExchangeId: () => EX1, now: () => new Date(ts) };

function question(id: string, keywordId: string, overrides: Row = {}): Row {
  return {
    id, owner_id: 'o1', material_id: M1, keyword_id: keywordId, question_text: `問${id}`, model_answer: `答${id}`,
    choices: [], explanation: null, sort_order: 0, is_active: true, doubt_flag: false, explanation_request_flag: false,
    version: 2, created_at: ts, updated_at: ts, ...overrides,
  };
}

function rpcTarget(keywordId: string, flagged: Row[] = []): Row {
  return {
    keywordId,
    metrics: { attempts: 4, correct: 1, wrong: 3, accuracy: 0.25, questionCount: 1 },
    reasons: flagged.length > 0 ? ['doubt-flag', 'performance-and-count'] : ['performance-and-count'],
    flaggedQuestions: flagged,
  };
}

function seed(): void {
  tables = {
    subjects: [{ id: S1, name: '科目', sort_order: 0 }],
    materials: [{ id: M1, subject_id: S1, name: '教材', sort_order: 1 }],
    chapters: [
      { id: C1, material_id: M1, parent_id: null, title: '章1', sort_order: 0, body: '{{答え|id=ab12cd}}' },
      { id: C2, material_id: M1, parent_id: C1, title: '節', sort_order: 0, body: 'なし' },
    ],
    keywords: [
      { id: KW1, material_id: M1, doc_id: 'ab12cd', answers: ['答え', '別解'], is_active: true },
      { id: KWX, material_id: M1, doc_id: 'xx99xx', answers: ['他'], is_active: true },
    ],
    structured_questions: [question(Q1, KW1, { doubt_flag: true }), question(Q2, KWX)],
  };
}

beforeEach(() => {
  seed();
  failTable = null;
  failFromOffset = 0;
  queryLog.length = 0;
  rpcCalls.length = 0;
  rpcImpl = () => Promise.resolve({
    data: [rpcTarget(KW1, [{ questionId: Q1, requestKinds: ['doubt'] }])], error: null,
  });
});

describe('mapEligibilityRpcResult', () => {
  it('RPCのjsonb配列をEligibilityTargetへ写像する', () => {
    expect(mapEligibilityRpcResult([rpcTarget(KW1)])).toEqual([{
      keywordId: KW1, metrics: { attempts: 4, correct: 1, wrong: 3, accuracy: 0.25, questionCount: 1 },
      reasons: ['performance-and-count'], flaggedQuestions: [],
    }]);
  });

  it('DBのjsonb化で15有効桁へ丸められたaccuracyはcorrect/attemptsの厳密値へ置き換える', () => {
    const [target] = mapEligibilityRpcResult([{
      ...rpcTarget(KW1), metrics: { attempts: 3, correct: 2, wrong: 1, accuracy: 0.666666666666667, questionCount: 1 },
    }]);
    expect(target!.metrics.accuracy).toBe(2 / 3);
  });

  it('attempts 0のaccuracyはnullのまま写像する', () => {
    const [target] = mapEligibilityRpcResult([{
      ...rpcTarget(KW1), metrics: { attempts: 0, correct: 0, wrong: 0, accuracy: null, questionCount: 1 },
    }]);
    expect(target!.metrics.accuracy).toBeNull();
  });

  it.each([
    ['配列でない', { keywordId: KW1 }],
    ['未知の理由', [{ ...rpcTarget(KW1), reasons: ['unknown'] }]],
    ['metrics欠落', [{ ...rpcTarget(KW1), metrics: { attempts: 1 } }]],
    ['不正なrequestKind', [rpcTarget(KW1, [{ questionId: Q1, requestKinds: ['x'] }])]],
    ['keywordId空', [rpcTarget('')]],
    ['accuracyがcorrect/attemptsと矛盾', [{ ...rpcTarget(KW1), metrics: { attempts: 4, correct: 1, wrong: 3, accuracy: 0.5, questionCount: 1 } }]],
    ['attempts 0でaccuracyが数値', [{ ...rpcTarget(KW1), metrics: { attempts: 0, correct: 0, wrong: 0, accuracy: 0, questionCount: 1 } }]],
  ])('%sの応答は日本語Errorにする', (_label, data) => {
    expect(() => mapEligibilityRpcResult(data)).toThrow(/抽出結果の形式が不正です/);
  });
});

describe('exportEligibleQuestions', () => {
  it('filterをRPC入力へ変換し、owner対象だけのschema v1 envelopeを返す', async () => {
    const result = await exportEligibleQuestions(filter, deps);
    expect(rpcCalls).toEqual([['get_question_exchange_candidates', {
      p_minimum_attempts: 3, p_maximum_accuracy: 0.5, p_maximum_question_count: 2,
    }]]);
    expect(result.kind).toBe('export');
    if (result.kind !== 'export') return;
    const value = result.value;
    expect(value).toMatchObject({ schemaVersion: 1, exchangeId: EX1, exportedAt: ts, filters: filter });
    expect(value.targets).toHaveLength(1);
    expect(value.targets[0]).toMatchObject({
      keyword: { id: KW1, displayText: '答え', modelAnswer: '答え、別解' },
      chapterContexts: [{
        subject: { id: S1, title: '科目' },
        material: { id: M1, title: '教材' },
        chapter: { id: C1, title: '章1', bodyMarkdown: '{{答え|id=ab12cd}}' },
      }],
      questions: [{ questionId: Q1, expectedVersion: 2, requestedFlags: ['doubt'] }],
    });
    expect(parseExchangeExport(serializeExchangeExport(value)).ok).toBe(true);
  });

  it('対象0件はdownload不可の空結果を返し補助読取をしない', async () => {
    rpcImpl = () => Promise.resolve({ data: [], error: null });
    expect(await exportEligibleQuestions(filter, deps)).toEqual({ kind: 'empty', filters: filter });
    expect(queryLog).toHaveLength(0);
  });

  it('RPC失敗は操作文脈付き日本語Errorにする', async () => {
    rpcImpl = () => Promise.resolve({ data: null, error: { message: 'fetch failed' } });
    await expect(exportEligibleQuestions(filter, deps)).rejects.toThrow('設問交換の抽出に失敗しました: fetch failed');
  });

  it('RPC通信例外も日本語Errorにする', async () => {
    rpcImpl = () => Promise.reject(new Error('offline'));
    await expect(exportEligibleQuestions(filter, deps)).rejects.toThrow('設問交換の抽出に失敗しました: offline');
  });

  it('1000件超の設問を全ページ読み、2ページ目の失敗では値を返さない', async () => {
    tables.structured_questions = Array.from({ length: 1205 }, (_, i) =>
      question(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, KW1, { sort_order: i }));
    rpcImpl = () => Promise.resolve({ data: [rpcTarget(KW1)], error: null });
    const ok = await exportEligibleQuestions(filter, deps);
    expect(ok.kind === 'export' && ok.value.targets[0]?.questions.length).toBe(1205);

    failTable = 'structured_questions';
    failFromOffset = 1000;
    await expect(exportEligibleQuestions(filter, deps)).rejects.toThrow(/設問交換の対象内容を読み込めませんでした/);
  });

  it.each(['keywords', 'chapters', 'materials', 'subjects'])('%sの読取失敗は日本語Errorにする', async (table) => {
    failTable = table;
    await expect(exportEligibleQuestions(filter, deps)).rejects.toThrow(/設問交換の対象内容を読み込めませんでした/);
  });

  it('参照先keywordが読めない場合は不完全なartifactを返さない', async () => {
    tables.keywords = [];
    await expect(exportEligibleQuestions(filter, deps)).rejects.toThrow(/設問交換の対象内容を読み込めませんでした/);
  });
});

describe('buildImportPreview', () => {
  beforeEach(() => {
    seed();
    failTable = null;
    queryLog.length = 0;
    rpcCalls.length = 0;
  });

  it('参照keyword/questionをID昇順chunkのSELECTだけで読みpreviewを作る', async () => {
    const many = Array.from({ length: 250 }, (_, i) => uuid(1000 + i));
    tables.structured_questions!.push(...many.map((id) => question(id, KW1)));
    const content = { questionText: '新', modelAnswer: '答', choices: [], explanation: null };
    const operations = many.map((questionId) => ({
      kind: 'update' as const, keywordId: KW1, questionId, expectedVersion: 2, question: content,
      sourceRequestedFlags: [], resolvedFlags: [],
    }));
    const envelope = { schemaVersion: 1 as const, exchangeId: EX1, exportedAt: ts, operations };
    const preview = await buildImportPreview(envelope);
    expect(preview.canCommit).toBe(true);
    expect(preview.source).toBe(envelope);
    expect(preview.items.filter((i) => i.kind === 'update')).toHaveLength(250);
    expect(rpcCalls).toEqual([]);
    const questionReads = queryLog.filter((q) => q.table === 'structured_questions');
    expect(questionReads.map((q) => q.inFilter?.[1].length)).toEqual([200, 50]);
    expect(questionReads.every((q) => q.order.join() === 'id')).toBe(true);
  });

  it('読取失敗は操作文脈付きErrorにする', async () => {
    failTable = 'keywords';
    const op = { kind: 'create' as const, keywordId: KW1, question: { questionText: '新', modelAnswer: '答', choices: [], explanation: null } };
    await expect(buildImportPreview({ schemaVersion: 1, exchangeId: EX1, exportedAt: ts, operations: [op] }))
      .rejects.toThrow('設問交換のpreviewを作成できませんでした: network down');
  });
});

describe('commitQuestionExchange', () => {
  const content = { questionText: '新', modelAnswer: '答', choices: [], explanation: null };
  const source = {
    schemaVersion: 1 as const, exchangeId: EX1, exportedAt: ts,
    operations: [
      { kind: 'create' as const, keywordId: KW1, question: content },
      { kind: 'update' as const, keywordId: KW1, questionId: Q1, expectedVersion: 2, question: content, sourceRequestedFlags: ['doubt' as const], resolvedFlags: ['doubt' as const] },
    ],
  };
  const committable = { canCommit: true, items: [], source };

  beforeEach(() => { rpcCalls.length = 0; });

  it('canCommitのvalidated envelopeだけをimport RPCへ渡し、件数を画面型へ写像する', async () => {
    rpcImpl = () => Promise.resolve({
      data: { createdCount: 1, updatedCount: 1, clearedDoubtCount: 1, clearedExplanationRequestCount: 0 }, error: null,
    });
    await expect(commitQuestionExchange(committable)).resolves.toEqual({
      created: 1, updated: 1, doubtFlagsCleared: 1, explanationRequestFlagsCleared: 0,
    });
    expect(rpcCalls).toEqual([['import_question_exchange', { p_payload: source }]]);
  });

  it.each([
    ['canCommit=false', { ...committable, canCommit: false }],
    ['envelopeなし', { canCommit: true, items: [] }],
  ])('%sのpreviewはRPCを呼ばずに拒否する', async (_name, preview) => {
    await expect(commitQuestionExchange(preview)).rejects.toThrow(/設問交換の取込に失敗しました/);
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ['PT409', 'version conflict', /操作 2.*previewの後に設問が更新されています/],
    ['P0002', 'question not found', /操作 2.*参照先のkeywordまたは設問が見つかりません/],
    ['22023', 'invalid question content', /操作 2.*取込内容が不正です.*invalid question content/],
    ['XX000', 'boom', /データベースで取込を確定できませんでした.*boom/],
  ])('RPC error %sを操作文脈付き日本語Errorにする', async (code, message, expected) => {
    rpcImpl = () => Promise.resolve({ data: null, error: { code, message, details: '$.operations[1]' } });
    await expect(commitQuestionExchange(committable)).rejects.toThrow(expected);
  });

  it('通信例外と不正な成功応答も日本語Errorにする', async () => {
    rpcImpl = () => Promise.reject(new Error('offline'));
    await expect(commitQuestionExchange(committable)).rejects.toThrow(/設問交換の取込に失敗しました.*offline/);
    rpcImpl = () => Promise.resolve({ data: { createdCount: -1 }, error: null });
    await expect(commitQuestionExchange(committable)).rejects.toThrow(/取込結果の形式が不正です/);
  });
});
