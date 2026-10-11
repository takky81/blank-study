import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';
import { RPC_SECURITY_MATRIX } from './rpc-security-matrix';

const CONTENT = { question_text: 'RLSで保護される設問', model_answer: 'owner', choices: ['other'], explanation: null };
const UPDATED_CONTENT = { ...CONTENT, question_text: '所有者だけが保存できる設問' };
const RPC_MATRIX = RPC_SECURITY_MATRIX;
const COMMANDS = ['create', 'update-content', 'set-flags', 'set-active', 'delete'] as const;

type Snapshot = {
  id: string; owner_id: string; keyword_id: string; question_text: string; version: number;
  model_answer: string; choices: string[]; explanation: string | null; sort_order: number;
  doubt_flag: boolean; explanation_request_flag: boolean; is_active: boolean;
};

function queryCatalog(sql: string): string {
  return execFileSync('docker', [
    'exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql,
  ], { encoding: 'utf8' }).trim();
}

function sqlAsRole(
  role: 'authenticated' | 'anon' | 'service_role', userId: string | null, sql: string, persist = false,
) {
  const claims = userId === null ? '{}' : JSON.stringify({ sub: userId, role });
  const output = queryCatalog(`begin; set local role ${role}; select set_config('request.jwt.claims', '${claims}', true); ${sql} ${persist ? 'commit' : 'rollback'};`);
  return output.split(/\r?\n/).filter((line) => line.startsWith('{')).at(-1) ?? output;
}

function apiClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(client: SupabaseClient, credentials = TEST_USER) {
  expect((await client.auth.signInWithPassword(credentials)).error).toBeNull();
}

async function createQuestion(client: SupabaseClient, keywordId: string, suffix: string) {
  const result = await client.rpc('mutate_structured_question', {
    p_command: 'create', p_keyword_id: keywordId,
    p_content: { ...CONTENT, question_text: `${CONTENT.question_text}-${suffix}` },
  });
  expect(result.error).toBeNull();
  return (result.data as { question: { id: string; version: number } }).question;
}

async function snapshot(ids: readonly string[]): Promise<Snapshot[]> {
  const result = await adminClient().from('structured_questions')
    .select('id,owner_id,keyword_id,question_text,model_answer,choices,explanation,version,sort_order,doubt_flag,explanation_request_flag,is_active')
    .in('id', [...ids]).order('id');
  if (result.error) throw result.error;
  return result.data as Snapshot[];
}

function expectNoLeak(error: { message: string; details?: string | null } | null, secrets: readonly string[]) {
  expect(error).not.toBeNull();
  const serialized = JSON.stringify(error);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

function expectNoCurrentVersionLeak(error: { message: string; details?: string | null } | null, version: number) {
  const serialized = JSON.stringify(error);
  for (const representation of [
    `\"version\":${version}`, `\"currentVersion\":${version}`, `\"current_version\":${version}`,
    `version ${version}`, `version=${version}`,
  ]) expect(serialized).not.toContain(representation);
}

test.describe.serial('QuestionRpcSecurityConformance', () => {
  test('公開user-data RPC catalogとmatrixが完全一致し、private primitiveは最小権限である', () => {
    const exposed = readFileSync('supabase/config.toml', 'utf8').match(/^schemas\s*=\s*\[(.*)]/m)?.[1] ?? '';
    expect(exposed).not.toContain('private');

    const catalog = JSON.parse(queryCatalog(`
      select coalesce(jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'EXECUTE');
    `)) as string[];
    expect(catalog).toEqual([...RPC_MATRIX].sort());

    const acl = JSON.parse(queryCatalog(`
      select jsonb_agg(jsonb_build_object(
        'identity', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'invoker', not p.prosecdef, 'config', p.proconfig,
        'publicExecute', has_function_privilege('public', p.oid, 'EXECUTE'),
        'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'serviceRoleExecute', has_function_privilege('service_role', p.oid, 'EXECUTE')) order by n.nspname, p.proname)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid in (
        'private.apply_structured_question_content(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure,
        'private.lock_structured_question_keyword_set()'::regprocedure,
        'public.mutate_structured_question(text,uuid,uuid,bigint,jsonb,jsonb)'::regprocedure,
        'public.reorder_structured_questions(uuid,jsonb)'::regprocedure,
        'public.set_structured_question_version()'::regprocedure);
    `)) as unknown[];
    expect(acl).toEqual([
      { identity: 'private.apply_structured_question_content(p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb)', invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false, authenticatedExecute: true, serviceRoleExecute: false },
      { identity: 'private.lock_structured_question_keyword_set()', invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false, authenticatedExecute: false, serviceRoleExecute: false },
      { identity: `public.${RPC_MATRIX[2]}`, invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false, authenticatedExecute: true, serviceRoleExecute: false },
      { identity: `public.${RPC_MATRIX[4]}`, invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false, authenticatedExecute: true, serviceRoleExecute: false },
      { identity: 'public.set_structured_question_version()', invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false, authenticatedExecute: false, serviceRoleExecute: false },
    ]);
    expect(JSON.parse(queryCatalog(`select jsonb_build_object(
      'authenticated', has_schema_privilege('authenticated','private','USAGE'),
      'anon', has_schema_privilege('anon','private','USAGE'),
      'service', has_schema_privilege('service_role','private','USAGE'),
      'public', has_schema_privilege('public','private','USAGE'));`)))
      .toEqual({ authenticated: true, anon: false, service: false, public: false });
  });

  test('全commandとreorderがowner成功・cross-owner拒否・anon拒否を満たす', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const otherEmail = `question-security-${randomUUID()}@example.com`;
    const otherPassword = 'test-password-123';
    const created = await adminClient().auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
    if (created.error) throw created.error;
    const otherId = created.data.user.id;
    try {
      const ownerKeyword = await seedMaterialWithKeyword(ownerId, await seedSubject(ownerId, 'security owner'), 'sec001');
      const otherKeyword = await seedMaterialWithKeyword(otherId, await seedSubject(otherId, 'security other'), 'sec002');
      const owner = apiClient(); const other = apiClient(); const anon = apiClient();
      await signIn(owner); await signIn(other, { email: otherEmail, password: otherPassword });
      const own = await Promise.all(COMMANDS.slice(1).map((c) => createQuestion(owner, ownerKeyword.keywordId, c)));
      const foreign = await Promise.all(COMMANDS.slice(1).map((c) => createQuestion(other, otherKeyword.keywordId, c)));
      const [ou, of, oa, od] = own; const [fu, ff, fa, fd] = foreign;
      if (!ou || !of || !oa || !od || !fu || !ff || !fa || !fd) throw new Error('fixture incomplete');

      const ownerCalls = [
        owner.rpc('mutate_structured_question', { p_command: 'create', p_keyword_id: ownerKeyword.keywordId, p_content: CONTENT }),
        owner.rpc('mutate_structured_question', { p_command: 'update-content', p_question_id: ou.id, p_expected_version: ou.version, p_content: UPDATED_CONTENT }),
        owner.rpc('mutate_structured_question', { p_command: 'set-flags', p_question_id: of.id, p_expected_version: of.version, p_flag_patch: { doubt_flag: true } }),
        owner.rpc('mutate_structured_question', { p_command: 'set-active', p_question_id: oa.id, p_expected_version: oa.version, p_flag_patch: { is_active: false } }),
        owner.rpc('mutate_structured_question', { p_command: 'delete', p_question_id: od.id, p_expected_version: od.version }),
      ];
      const ownerResults = [];
      for (const call of ownerCalls) {
        const result = await call;
        expect(result.error).toBeNull();
        ownerResults.push(result);
      }
      const createdOwnerId = (ownerResults[0]?.data as { question: { id: string } }).question.id;
      const persistedOwner = await snapshot([createdOwnerId, ou.id, of.id, oa.id, od.id]);
      expect(persistedOwner.find(({ id }) => id === createdOwnerId)).toMatchObject({
        keyword_id: ownerKeyword.keywordId, question_text: CONTENT.question_text,
        model_answer: CONTENT.model_answer, choices: CONTENT.choices, explanation: null,
        doubt_flag: false, explanation_request_flag: false, is_active: true, version: 1,
      });
      expect(persistedOwner.find(({ id }) => id === ou.id)).toMatchObject({
        question_text: UPDATED_CONTENT.question_text, model_answer: UPDATED_CONTENT.model_answer,
        choices: UPDATED_CONTENT.choices, explanation: null, version: ou.version + 1,
      });
      expect(persistedOwner.find(({ id }) => id === of.id)).toMatchObject({
        doubt_flag: true, explanation_request_flag: false, version: of.version + 1,
      });
      expect(persistedOwner.find(({ id }) => id === oa.id)).toMatchObject({
        is_active: false, version: oa.version + 1,
      });
      expect(persistedOwner.some(({ id }) => id === od.id)).toBe(false);

      const crossCalls = [
        () => owner.rpc('mutate_structured_question', { p_command: 'create', p_keyword_id: otherKeyword.keywordId, p_content: CONTENT }),
        () => owner.rpc('mutate_structured_question', { p_command: 'update-content', p_question_id: fu.id, p_expected_version: fu.version, p_content: UPDATED_CONTENT }),
        () => owner.rpc('mutate_structured_question', { p_command: 'set-flags', p_question_id: ff.id, p_expected_version: ff.version, p_flag_patch: { doubt_flag: true } }),
        () => owner.rpc('mutate_structured_question', { p_command: 'set-active', p_question_id: fa.id, p_expected_version: fa.version, p_flag_patch: { is_active: false } }),
        () => owner.rpc('mutate_structured_question', { p_command: 'delete', p_question_id: fd.id, p_expected_version: fd.version }),
      ];
      for (let index = 0; index < crossCalls.length; index += 1) {
        const before = await snapshot(foreign.map(({ id }) => id));
        const invoke = crossCalls[index];
        if (!invoke) throw new Error('cross-owner command incomplete');
        const result = await invoke();
        const target = index === 0 ? fu : foreign[index - 1];
        if (!target) throw new Error('cross-owner fixture incomplete');
        expectNoLeak(result.error, [otherKeyword.keywordId, target.id, before.find(({ id }) => id === target.id)?.question_text ?? '', UPDATED_CONTENT.question_text]);
        expectNoCurrentVersionLeak(result.error, target.version);
        expect(await snapshot(foreign.map(({ id }) => id))).toEqual(before);
      }

      const anonCalls = [
        anon.rpc('mutate_structured_question', { p_command: 'create', p_keyword_id: ownerKeyword.keywordId, p_content: CONTENT }),
        anon.rpc('mutate_structured_question', { p_command: 'update-content', p_question_id: ou.id, p_expected_version: ou.version, p_content: UPDATED_CONTENT }),
        anon.rpc('mutate_structured_question', { p_command: 'set-flags', p_question_id: of.id, p_expected_version: of.version, p_flag_patch: { doubt_flag: true } }),
        anon.rpc('mutate_structured_question', { p_command: 'set-active', p_question_id: oa.id, p_expected_version: oa.version, p_flag_patch: { is_active: false } }),
        anon.rpc('mutate_structured_question', { p_command: 'delete', p_question_id: od.id, p_expected_version: od.version }),
      ];
      for (const call of anonCalls) expect((await call).error).not.toBeNull();

      const ownRows = (await snapshot([createdOwnerId, ou.id, of.id, oa.id]))
        .map(({ id, version }) => ({ id, version })).reverse();
      expect((await owner.rpc('reorder_structured_questions', { p_keyword_id: ownerKeyword.keywordId, p_ordered: ownRows })).error).toBeNull();
      const reordered = await snapshot(ownRows.map(({ id }) => id));
      const byOrder = [...reordered].sort((left, right) => left.sort_order - right.sort_order);
      expect(byOrder.map(({ id }) => id)).toEqual(ownRows.map(({ id }) => id));
      expect(byOrder.map(({ id, version }) => ({ id, version }))).toEqual(
        ownRows.map(({ id, version }) => ({ id, version: version + 1 })),
      );
      const before = await snapshot(foreign.map(({ id }) => id));
      const crossReorder = await owner.rpc('reorder_structured_questions', { p_keyword_id: otherKeyword.keywordId, p_ordered: before.map(({ id, version }) => ({ id, version })) });
      expectNoLeak(crossReorder.error, [otherKeyword.keywordId, fu.id, before.find(({ id }) => id === fu.id)?.question_text ?? '']);
      expectNoCurrentVersionLeak(crossReorder.error, fu.version);
      expect(await snapshot(foreign.map(({ id }) => id))).toEqual(before);
      expect((await anon.rpc('reorder_structured_questions', { p_keyword_id: ownerKeyword.keywordId, p_ordered: ownRows })).error).not.toBeNull();

      const crossRead = await owner.from('structured_questions').select('id,question_text,version').in('id', foreign.map(({ id }) => id));
      expect(crossRead.error).toBeNull(); expect(crossRead.data).toEqual([]);
      const crossUpdate = await owner.from('structured_questions').update({ question_text: '変更してはいけない' }).eq('id', fu.id).select('id');
      expect(crossUpdate.error).toBeNull(); expect(crossUpdate.data).toEqual([]);
      expect((await anon.from('structured_questions').select('id')).error).not.toBeNull();
    } finally {
      await resetData(otherId); await adminClient().auth.admin.deleteUser(otherId); await resetData(ownerId);
    }
  });

  test('primitiveは4主体を自身で再検証し、REST/RPCからは直接到達不能である', async () => {
    const ownerId = await ensureTestUser(); await resetData(ownerId);
    const otherEmail = `question-primitive-${randomUUID()}@example.com`; const otherPassword = 'test-password-123';
    const created = await adminClient().auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
    if (created.error) throw created.error;
    const otherId = created.data.user.id;
    try {
      const keyword = await seedMaterialWithKeyword(ownerId, await seedSubject(ownerId, 'primitive owner'), 'pri001');
      await seedMaterialWithKeyword(otherId, await seedSubject(otherId, 'primitive other'), 'pri002');
      const id = randomUUID(); const content = JSON.stringify(CONTENT).replaceAll("'", "''");
      const saved = sqlAsRole('authenticated', ownerId, `select private.apply_structured_question_content('${id}', '${keyword.keywordId}', null, '${content}', '{"__create":true}');`, true);
      expect(JSON.parse(saved)).toMatchObject({ kind: 'saved', question: { id } });
      for (const [role, actor] of [['authenticated', otherId], ['anon', null], ['service_role', null]] as const) {
        expect(() => sqlAsRole(role, actor, `select private.apply_structured_question_content('${id}', null, 1, null, '{"doubt_flag":true}');`)).toThrow();
      }
      expect(await snapshot([id])).toMatchObject([{ version: 1, doubt_flag: false }]);

      const owner = apiClient(); const anon = apiClient(); await signIn(owner);
      for (const client of [anon, owner]) {
        const token = (await client.auth.getSession()).data.session?.access_token ?? SUPABASE_ANON_KEY;
        for (const endpoint of ['rpc/apply_structured_question_content', 'apply_structured_question_content']) {
          const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
          expect([404, 405]).toContain(response.status);
        }
      }
      // exchange orchestrationは未実装。公開bank RPCからの同一transaction委譲は全command成功ケースで固定済み。
    } finally {
      await resetData(otherId); await adminClient().auth.admin.deleteUser(otherId); await resetData(ownerId);
    }
  });
});
