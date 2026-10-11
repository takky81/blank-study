import { execFileSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

test.describe.configure({ mode: 'serial' });

const MARKER = '注入失敗マーカー';
const TRIGGER = 'qx_atomicity_fault';
const content = { questionText: '取込後の問い', modelAnswer: '答え', choices: ['誤り'], explanation: '解説' };

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function triggerExists(): boolean {
  return psql(`select count(*) from pg_trigger where tgname = '${TRIGGER}'`) !== '0'
    || psql(`select count(*) from pg_proc where proname = '${TRIGGER}_fn'`) !== '0';
}

/** 対象ownerかつmarker本文の行だけで失敗する一時triggerを作り、finallyで必ず消す。 */
async function withFaultTrigger<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
  const fn = `public.${TRIGGER}_fn`;
  psql([
    `create or replace function ${fn}() returns trigger language plpgsql as $f$ begin ` +
      `if new.owner_id = '${ownerId}'::uuid and new.question_text = '${MARKER}' then ` +
      `raise exception 'injected fault ${TRIGGER}'; end if; return new; end $f$`,
    `create trigger ${TRIGGER} before insert or update on public.structured_questions ` +
      `for each row execute function ${fn}()`,
  ].join('; '));
  try {
    return await run();
  } finally {
    psql(`drop trigger if exists ${TRIGGER} on public.structured_questions; drop function if exists ${fn}()`);
  }
}

async function seedQuestion(ownerId: string, materialId: string, keywordId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId, question_text: '古い問い', model_answer: '答え',
    choices: [], sort_order: 0, ...overrides,
  }).select('id, version').single();
  if (error) throw error;
  return data as { id: string; version: number };
}

async function snapshot(ownerId: string) {
  const res = await adminClient().from('structured_questions').select('*').eq('owner_id', ownerId).order('id');
  if (res.error) throw res.error;
  return res.data;
}

function payload(operations: Record<string, unknown>[]) {
  return {
    p_payload: {
      schemaVersion: 1, exchangeId: 'e7000000-0000-4000-8000-0000000000aa', exportedAt: '2026-10-11T00:00:00Z', operations,
    },
  };
}

test.describe('QuestionExchangeAtomicityConformance', () => {
  let ownerId = '';
  let materialId = '';
  let keywordId = '';
  let user: SupabaseClient;

  test.beforeEach(async () => {
    ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '交換atomicity');
    ({ materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xa0001'));
    user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    expect((await user.auth.signInWithPassword(TEST_USER)).error).toBeNull();
  });

  test.afterEach(async () => {
    await resetData(ownerId);
  });

  const paths = [
    { name: 'create', build: () => ({ kind: 'create', keywordId, question: { ...content, questionText: MARKER } }) },
    {
      name: 'update',
      build: (q3: { id: string; version: number }) => ({
        kind: 'update', keywordId, questionId: q3.id, expectedVersion: q3.version,
        question: { ...content, questionText: MARKER }, sourceRequestedFlags: [], resolvedFlags: [],
      }),
    },
  ];

  for (const path of paths) {
    test(`先行するcreate/updateとflag解除の後に${path.name}処理中のRPC内部例外が起きると全operationが巻き戻る`, async () => {
      const q1 = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, explanation_request_flag: true });
      const q2 = await seedQuestion(ownerId, materialId, keywordId, { explanation_request_flag: true, sort_order: 1 });
      const q3 = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, sort_order: 2 });
      const operations = [
        { kind: 'create', keywordId, question: content },
        {
          kind: 'update', keywordId, questionId: q1.id, expectedVersion: q1.version, question: content,
          sourceRequestedFlags: ['doubt', 'explanation-request'], resolvedFlags: ['doubt', 'explanation-request'],
        },
        {
          kind: 'update', keywordId, questionId: q2.id, expectedVersion: q2.version, question: content,
          sourceRequestedFlags: ['explanation-request'], resolvedFlags: ['explanation-request'],
        },
        path.build(q3),
      ];
      const before = await snapshot(ownerId);
      expect(before).toHaveLength(3);

      const result = await withFaultTrigger(ownerId, async () => {
        expect(triggerExists()).toBe(true);
        return await user.rpc('import_question_exchange', payload(operations));
      });
      expect(triggerExists()).toBe(false);

      expect(result.error?.message).toContain(`injected fault ${TRIGGER}`);
      expect(result.data).toBeNull();
      const after = await snapshot(ownerId);
      expect(after).toEqual(before);
      expect(after.some((r) => r.question_text === content.questionText || r.question_text === MARKER)).toBe(false);

      // 同じpayloadから失敗要因だけを除くと成功し、先行operationが実際に有効だったことを示す。
      const ok = await user.rpc('import_question_exchange', payload(operations.slice(0, 3)));
      expect(ok.error).toBeNull();
      expect(ok.data).toEqual({ createdCount: 1, updatedCount: 2, clearedDoubtCount: 1, clearedExplanationRequestCount: 2 });
    });
  }
});
