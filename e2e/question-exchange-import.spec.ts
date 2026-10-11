import { execFileSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

test.describe.configure({ mode: 'serial' });

const OTHER_USER = { email: 'e2e-exchange-import-other@example.test', password: 'e2epassword' };
const content = { questionText: '取込後の問い', modelAnswer: '答え', choices: ['誤り'], explanation: '解説' };

type Op = Record<string, unknown>;
type Ctx = { kw: string; foreignKw: string; q: { id: string; version: number }; q2: { id: string; version: number }; foreignQ: { id: string } };

async function ensureUser(credentials: { email: string; password: string }): Promise<string> {
  const db = adminClient();
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw error;
  const existing = data.users.find((u) => u.email === credentials.email);
  if (existing) return existing.id;
  const created = await db.auth.admin.createUser({ ...credentials, email_confirm: true });
  if (created.error) throw created.error;
  return created.data.user.id;
}

async function signIn(credentials = TEST_USER): Promise<SupabaseClient> {
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  expect((await user.auth.signInWithPassword(credentials)).error).toBeNull();
  return user;
}

async function seedQuestion(ownerId: string, materialId: string, keywordId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId, question_text: '古い問い', model_answer: '答え',
    choices: [], sort_order: 0, ...overrides,
  }).select('id, version').single();
  if (error) throw error;
  return data as { id: string; version: number };
}

async function dbSnapshot(ownerIds: string[]) {
  const questions = await adminClient().from('structured_questions').select('*').in('owner_id', ownerIds).order('id');
  if (questions.error) throw questions.error;
  return questions.data;
}

function payload(operations: Op[], extra: Record<string, unknown> = {}) {
  return {
    p_payload: {
      schemaVersion: 1, exchangeId: 'e7000000-0000-4000-8000-0000000000ff', exportedAt: '2026-10-11T00:00:00Z',
      operations, ...extra,
    },
  };
}

function sqlAsUser(userId: string, sql: string): string {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return execFileSync('docker', [
    'exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=0', '-c',
    `begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); ${sql} rollback;`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test.describe('AtomicImportRPCValidation', () => {
  let ownerId = '';
  let otherId = '';
  let materialId = '';
  let keywordId = '';
  let otherKeywordId = '';
  let user: SupabaseClient;

  test.beforeEach(async () => {
    ownerId = await ensureTestUser();
    otherId = await ensureUser(OTHER_USER);
    await resetData(ownerId);
    await resetData(otherId);
    const subjectId = await seedSubject(ownerId, '交換import');
    ({ materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xi0001'));
    const otherSubject = await seedSubject(otherId, '他人');
    ({ keywordId: otherKeywordId } = await seedMaterialWithKeyword(otherId, otherSubject, 'xi0002'));
    user = await signIn();
  });

  test.afterEach(async () => {
    await resetData(ownerId);
    await resetData(otherId);
  });

  test('create/updateの混在payloadを全検証後にbank primitiveへ委譲し、owner値はauth.uid()で決まる', async () => {
    const q = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, explanation_request_flag: true });
    const result = await user.rpc('import_question_exchange', payload([
      { kind: 'create', keywordId, question: content, ownerId: otherId, owner_id: otherId },
      {
        kind: 'update', keywordId, questionId: q.id, expectedVersion: q.version, question: content,
        sourceRequestedFlags: ['doubt', 'explanation-request'], resolvedFlags: ['doubt'], ownerId: otherId,
      },
    ], { ownerId: otherId }));
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ createdCount: 1, updatedCount: 1, clearedDoubtCount: 1, clearedExplanationRequestCount: 0 });

    const rows = await dbSnapshot([ownerId, otherId]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.owner_id === ownerId && r.question_text === '取込後の問い')).toBe(true);
    const updated = rows.find((r) => r.id === q.id);
    expect(updated).toMatchObject({ version: q.version + 1, doubt_flag: false, explanation_request_flag: true });
  });

  const invalidCases: { name: string; build: (ctx: Ctx) => Op }[] = [
    { name: '他ownerのkeyword', build: ({ foreignKw }) => ({ kind: 'create', keywordId: foreignKw, question: content }) },
    { name: '他ownerのquestion', build: ({ kw, foreignQ }) => ({ kind: 'update', keywordId: kw, questionId: foreignQ.id, expectedVersion: 1, question: content, sourceRequestedFlags: [], resolvedFlags: [] }) },
    { name: 'keywordとquestionの不一致', build: ({ kw, q2 }) => ({ kind: 'update', keywordId: kw, questionId: q2.id, expectedVersion: q2.version, question: content, sourceRequestedFlags: [], resolvedFlags: [] }) },
    { name: '不正な内容（空の問題文）', build: ({ kw }) => ({ kind: 'create', keywordId: kw, question: { ...content, questionText: '  ' } }) },
    { name: '模範解答と重複する選択肢（bank規則）', build: ({ kw }) => ({ kind: 'create', keywordId: kw, question: { ...content, choices: ['ＡＮＳ'], modelAnswer: 'ans' } }) },
    { name: 'staleなexpectedVersion', build: ({ kw, q }) => ({ kind: 'update', keywordId: kw, questionId: q.id, expectedVersion: q.version + 1, question: content, sourceRequestedFlags: [], resolvedFlags: [] }) },
    { name: '同じquestion IDの重複', build: ({ kw, q }) => ({ kind: 'update', keywordId: kw, questionId: q.id, expectedVersion: q.version, question: content, sourceRequestedFlags: [], resolvedFlags: [] }) },
    { name: 'sourceRequestedFlagsを超えるresolvedFlags', build: ({ kw, q }) => ({ kind: 'update', keywordId: kw, questionId: q.id, expectedVersion: q.version, question: content, sourceRequestedFlags: [], resolvedFlags: ['doubt'] }) },
    { name: '現在立っていないflagの解除', build: ({ kw, q }) => ({ kind: 'update', keywordId: kw, questionId: q.id, expectedVersion: q.version, question: content, sourceRequestedFlags: ['explanation-request'], resolvedFlags: ['explanation-request'] }) },
  ];

  for (const testCase of invalidCases) {
    test(`${testCase.name}が1件あるだけで全operationを拒否しDBを変更しない`, async () => {
      const q = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true });
      const secondSubject = await seedSubject(ownerId, '別科目', 1);
      const second = await seedMaterialWithKeyword(ownerId, secondSubject, 'xi0003');
      const q2 = await seedQuestion(ownerId, second.materialId, second.keywordId);
      const foreignQ = await seedQuestion(otherId, (await adminClient().from('keywords').select('material_id').eq('id', otherKeywordId).single()).data!.material_id, otherKeywordId);
      const valid: Op[] = [
        { kind: 'create', keywordId, question: content },
        { kind: 'update', keywordId, questionId: q.id, expectedVersion: q.version, question: content, sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt'] },
      ];
      const before = await dbSnapshot([ownerId, otherId]);
      const result = await user.rpc('import_question_exchange', payload([...valid, testCase.build({ kw: keywordId, foreignKw: otherKeywordId, q, q2, foreignQ })]));
      expect(result.error).not.toBeNull();
      expect(result.data).toBeNull();
      expect(await dbSnapshot([ownerId, otherId])).toEqual(before);
    });
  }

  test('stale競合はPT409、未知/他ownerの参照は同じP0002表現で返す', async () => {
    const q = await seedQuestion(ownerId, materialId, keywordId);
    const stale = await user.rpc('import_question_exchange', payload([
      { kind: 'update', keywordId, questionId: q.id, expectedVersion: q.version + 5, question: content, sourceRequestedFlags: [], resolvedFlags: [] },
    ]));
    expect(stale.error?.code).toBe('PT409');
    expect(JSON.stringify(stale.error)).not.toContain('古い問い');
    const foreign = await user.rpc('import_question_exchange', payload([{ kind: 'create', keywordId: otherKeywordId, question: content }]));
    const unknown = await user.rpc('import_question_exchange', payload([{ kind: 'create', keywordId: 'e7000000-0000-4000-8000-000000000001', question: content }]));
    expect(foreign.error?.code).toBe('P0002');
    expect({ ...foreign.error }).toEqual({ ...unknown.error });
  });

  test('bank primitive自身もowner・keyword・期待版・内容を再検証する', async () => {
    const q = await seedQuestion(ownerId, materialId, keywordId);
    const call = (actor: string, args: string) =>
      sqlAsUser(actor, `select private.apply_structured_question_content(${args});`);
    const body = `'{"question_text":"x","model_answer":"y","choices":[]}'::jsonb`;
    expect(() => call(otherId, `'${q.id}', '${keywordId}', ${q.version}, ${body}, '{}'::jsonb`)).toThrow(/question not found/);
    expect(() => call(ownerId, `'${q.id}', '${otherKeywordId}', ${q.version}, ${body}, '{}'::jsonb`)).toThrow(/do not match/);
    expect(() => call(ownerId, `'${q.id}', '${keywordId}', ${q.version}, '{"question_text":" ","model_answer":"y","choices":[]}'::jsonb, '{}'::jsonb`)).toThrow(/question_text is required/);
    expect(call(ownerId, `'${q.id}', '${keywordId}', ${q.version + 1}, ${body}, '{}'::jsonb`)).toContain('version-conflict');
  });
});
