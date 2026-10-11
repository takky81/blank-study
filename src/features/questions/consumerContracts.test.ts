import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

type QuestionRow = {
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

let stored: QuestionRow;
const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { from, rpc } }));

import { flagMutationContract, structuredQuestionReadContract } from './api';
import type { FlagMutationContract, StructuredQuestionReadContract } from './types';

const readContract: StructuredQuestionReadContract = structuredQuestionReadContract;
const mutationContract: FlagMutationContract = flagMutationContract;

function makeRow(): QuestionRow {
  return {
    id: 'question-1', owner_id: 'owner-1', material_id: 'material-1', keyword_id: 'keyword-1',
    question_text: '設問', model_answer: '答え', choices: ['誤答'], explanation: '既存の解説',
    sort_order: 0, is_active: true, doubt_flag: false, explanation_request_flag: false,
    version: 1, created_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-11T00:00:00.000Z',
  };
}

beforeEach(() => {
  stored = makeRow();
  from.mockReset();
  rpc.mockReset();
  from.mockImplementation((table: string) => {
    expect(table).toBe('structured_questions');
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query),
      range: vi.fn(() => Promise.resolve({ data: [stored], count: 1, error: null })),
    };
    return query;
  });
  rpc.mockImplementation((_name: string, args: Record<string, unknown>) => {
    if (args.p_expected_version !== stored.version) {
      return Promise.resolve({ data: { kind: 'version-conflict', current: stored }, error: null });
    }
    const patch = args.p_flag_patch as Record<string, boolean>;
    stored = {
      ...stored,
      doubt_flag: patch.doubt_flag ?? stored.doubt_flag,
      explanation_request_flag: patch.explanation_request_flag ?? stored.explanation_request_flag,
      version: stored.version + 1,
    };
    return Promise.resolve({ data: { kind: 'saved', question: stored }, error: null });
  });
});

describe('study/exchange consumer向け設問契約', () => {
  it('教材読取から安定ID・version token・既存解説を取得し、公開flag契約だけで両flagを独立設定する', async () => {
    const [question] = await readContract.listQuestionsByMaterial('material-1');
    expect(question).toMatchObject({
      id: 'question-1', version: 1, updatedAt: '2026-10-11T00:00:00.000Z', explanation: '既存の解説',
    });

    const doubt = await mutationContract.setQuestionFlags(question!.id, question!.version, { doubtFlag: true });
    expect(doubt).toMatchObject({
      kind: 'saved', question: { doubtFlag: true, explanationRequestFlag: false, version: 2 },
    });
    if (doubt.kind !== 'saved') throw new Error('疑義flagの更新に失敗しました');

    const explanation = await mutationContract.setQuestionFlags(
      doubt.question.id,
      doubt.question.version,
      { explanationRequestFlag: true },
    );
    expect(explanation).toMatchObject({
      kind: 'saved',
      question: { explanation: '既存の解説', doubtFlag: true, explanationRequestFlag: true, version: 3 },
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, args]) => (args as Record<string, unknown>).p_flag_patch)).toEqual([
      { doubt_flag: true },
      { explanation_request_flag: true },
    ]);
  });

  it('DB row・choices・結果配列への参照をconsumerへ共有しない', async () => {
    const questions = await readContract.listQuestionsByMaterial('material-1');
    const question = questions[0]!;
    stored.question_text = 'DB側で後から変更';
    stored.choices.push('DB側の追加');

    expect(question.questionText).toBe('設問');
    expect(question.choices).toEqual(['誤答']);
    expect(Object.isFrozen(questions)).toBe(true);
    expect(Object.isFrozen(question)).toBe(true);
    expect(Object.isFrozen(question.choices)).toBe(true);

    const mutation = await mutationContract.setQuestionFlags(question.id, question.version, {
      doubtFlag: true,
    });
    if (mutation.kind !== 'saved') throw new Error('flagの更新に失敗しました');
    stored.choices.push('mutation後のDB側追加');
    expect(mutation.question.choices).toEqual(['誤答', 'DB側の追加']);
    expect(Object.isFrozen(mutation)).toBe(true);
    expect(Object.isFrozen(mutation.question)).toBe(true);
    expect(Object.isFrozen(mutation.question.choices)).toBe(true);
  });

  it('古いversion tokenを競合として返し、公開契約が直接table書込を行わない', async () => {
    const result = await mutationContract.setQuestionFlags('question-1', 0, { doubtFlag: true });
    expect(result).toMatchObject({ kind: 'version-conflict', current: { id: 'question-1', version: 1 } });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('mutate_structured_question', expect.objectContaining({
      p_command: 'set-flags', p_question_id: 'question-1', p_expected_version: 0,
    }));
  });

  it('独立consumer fixtureが公開契約だけに依存する', () => {
    const source = readFileSync('e2e/harness/structured-question-consumer.ts', 'utf8');
    expect(source).toContain("from '../../src/features/questions/api'");
    expect(source).toContain("from '../../src/features/questions/types'");
    expect(source).not.toMatch(/supabase|\.from\s*\(|\.rpc\s*\(|structured_questions/);
  });
});
