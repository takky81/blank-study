import { execFileSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';
import { questionContentCases } from './question-bank-conformance-fixtures';

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
    const q = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, doubt_note: '疑義メモ', doubt_reasons: ['low_value'], explanation_request_flag: true });
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
    expect(updated).toMatchObject({ version: q.version + 1, doubt_flag: false, doubt_note: null, doubt_reasons: [], explanation_request_flag: true });
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

function sqlAsAdmin(sql: string): string {
  return execFileSync('docker', [
    'exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function toExchangeContent(c: Record<string, unknown>) {
  return { questionText: c.question_text, modelAnswer: c.model_answer, choices: c.choices, explanation: c.explanation };
}

const PRIMITIVE = 'private.apply_structured_question_content(uuid,uuid,bigint,jsonb,jsonb)';
const IMPORT_RPC = 'public.import_question_exchange(jsonb)';

test.describe('AtomicImportRPCMutation', () => {
  let ownerId = '';
  let materialId = '';
  let keywordId = '';
  let user: SupabaseClient;

  test.beforeEach(async () => {
    ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '交換import確定');
    ({ materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xm0001'));
    user = await signIn();
  });

  test.afterEach(async () => {
    await resetData(ownerId);
  });

  test('private schemaのUSAGEと正確なsignatureのEXECUTEはauthenticatedだけに許可される', () => {
    const row = JSON.parse(sqlAsAdmin(`select json_build_object(
      'usage', json_build_object(
        'authenticated', has_schema_privilege('authenticated', 'private', 'USAGE'),
        'anon', has_schema_privilege('anon', 'private', 'USAGE'),
        'public', has_schema_privilege('public', 'private', 'USAGE'),
        'createAuthenticated', has_schema_privilege('authenticated', 'private', 'CREATE')),
      'primitive', json_build_object(
        'authenticated', has_function_privilege('authenticated', '${PRIMITIVE}', 'EXECUTE'),
        'anon', has_function_privilege('anon', '${PRIMITIVE}', 'EXECUTE'),
        'public', has_function_privilege('public', '${PRIMITIVE}', 'EXECUTE')),
      'otherPrivateExecutable', (select coalesce(json_agg(p.oid::regprocedure::text), '[]'::json)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and p.oid <> '${PRIMITIVE}'::regprocedure),
      'import', json_build_object(
        'invoker', (select not prosecdef from pg_proc where oid = '${IMPORT_RPC}'::regprocedure),
        'authenticated', has_function_privilege('authenticated', '${IMPORT_RPC}', 'EXECUTE'),
        'anon', has_function_privilege('anon', '${IMPORT_RPC}', 'EXECUTE'),
        'public', has_function_privilege('public', '${IMPORT_RPC}', 'EXECUTE')));`));
    expect(row).toEqual({
      usage: { authenticated: true, anon: false, public: false, createAuthenticated: false },
      primitive: { authenticated: true, anon: false, public: false },
      otherPrivateExecutable: [],
      import: { invoker: true, authenticated: true, anon: false, public: false },
    });
  });

  test('未解除flag・未要求flag・file外設問を維持し、片flag/両flag解除のcountを正しく返す', async () => {
    const flags = { doubt_flag: true, explanation_request_flag: true };
    const both = await seedQuestion(ownerId, materialId, keywordId, { ...flags, sort_order: 0 });
    const onlyExplanation = await seedQuestion(ownerId, materialId, keywordId, { ...flags, sort_order: 1 });
    const unresolved = await seedQuestion(ownerId, materialId, keywordId, { ...flags, sort_order: 2 });
    const outside = await seedQuestion(ownerId, materialId, keywordId, { ...flags, sort_order: 3 });
    const outsideBefore = (await dbSnapshot([ownerId])).find((r) => r.id === outside.id);
    const update = (q: { id: string; version: number }, source: string[], resolved: string[]) => ({
      kind: 'update', keywordId, questionId: q.id, expectedVersion: q.version, question: content,
      sourceRequestedFlags: source, resolvedFlags: resolved,
    });
    const result = await user.rpc('import_question_exchange', payload([
      { kind: 'create', keywordId, question: content },
      { kind: 'create', keywordId, question: { ...content, questionText: '二つ目の新規' } },
      update(both, ['doubt', 'explanation-request'], ['doubt', 'explanation-request']),
      update(onlyExplanation, ['explanation-request'], ['explanation-request']),
      update(unresolved, ['doubt', 'explanation-request'], []),
    ]));
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ createdCount: 2, updatedCount: 3, clearedDoubtCount: 1, clearedExplanationRequestCount: 2 });

    const rows = await dbSnapshot([ownerId]);
    expect(rows).toHaveLength(6);
    const byId = (id: string) => rows.find((r) => r.id === id);
    expect(byId(both.id)).toMatchObject({ version: both.version + 1, doubt_flag: false, explanation_request_flag: false });
    expect(byId(onlyExplanation.id)).toMatchObject({ version: onlyExplanation.version + 1, doubt_flag: true, explanation_request_flag: false });
    expect(byId(unresolved.id)).toMatchObject({ version: unresolved.version + 1, ...flags, question_text: '取込後の問い' });
    expect(byId(outside.id)).toEqual(outsideBefore);
    const seeded = [both.id, onlyExplanation.id, unresolved.id, outside.id];
    const created = rows.filter((r) => !seeded.includes(r.id));
    expect(created).toHaveLength(2);
    expect(created.every((r) => r.version === 1 && !r.doubt_flag && !r.explanation_request_flag)).toBe(true);
  });

  for (const fixture of questionContentCases) {
    test(`bank共有fixture「${fixture.name}」で通常編集とimportの内容検証・版・flag保持が一致する`, async () => {
      const flags = { doubt_flag: true, explanation_request_flag: true };
      const editQ = await seedQuestion(ownerId, materialId, keywordId, { ...flags, sort_order: 0 });
      const importQ = await seedQuestion(ownerId, materialId, keywordId, { ...flags, sort_order: 1 });
      const edited = await user.rpc('mutate_structured_question', {
        p_command: 'update-content', p_question_id: editQ.id, p_expected_version: editQ.version, p_content: fixture.content,
      });
      const imported = await user.rpc('import_question_exchange', payload([{
        kind: 'update', keywordId, questionId: importQ.id, expectedVersion: importQ.version,
        question: toExchangeContent(fixture.content), sourceRequestedFlags: ['doubt'], resolvedFlags: [],
      }]));
      const pick = (r: Record<string, unknown> | undefined) => r && ({
        question_text: r.question_text, model_answer: r.model_answer, choices: r.choices, explanation: r.explanation,
        version: r.version, doubt_flag: r.doubt_flag, explanation_request_flag: r.explanation_request_flag,
      });
      const rows = await dbSnapshot([ownerId]);
      const editRow = pick(rows.find((r) => r.id === editQ.id));
      const importRow = pick(rows.find((r) => r.id === importQ.id));
      if (fixture.valid) {
        expect(edited.error).toBeNull();
        expect(imported.error).toBeNull();
        expect(importRow).toEqual(editRow);
        expect(importRow).toEqual({ ...fixture.expected, version: importQ.version + 1, ...flags });
      } else {
        expect(edited.error).not.toBeNull();
        expect(imported.error).not.toBeNull();
        expect(importRow).toEqual(editRow);
        expect(importRow).toMatchObject({ version: importQ.version, question_text: '古い問い', ...flags });
      }
    });
  }
});
