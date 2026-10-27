import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';
import { PUBLIC_RPC_CATALOG_SQL, RPC_SECURITY_MATRIX } from './rpc-security-matrix';

const CANDIDATES_RPC = 'get_question_exchange_candidates';
const IMPORT_RPC = 'import_question_exchange';
const PUBLIC_SIGNATURES = {
  [CANDIDATES_RPC]: 'public.get_question_exchange_candidates(numeric,numeric,numeric,boolean,boolean)',
  [IMPORT_RPC]: 'public.import_question_exchange(jsonb)',
} as const;
const PRIMITIVE_NAME = 'apply_structured_question_content';
const PRIMITIVE = 'private.apply_structured_question_content(uuid,uuid,bigint,jsonb,jsonb)';
const SECRET_TEXT = '他人に見せてはいけない交換設問';
const SECRET_ANSWER = '他人の交換模範解答';
const content = { questionText: '取込した問い', modelAnswer: '答え', choices: ['誤り'], explanation: '解説' };

function queryCatalog(sql: string): string {
  return execFileSync('docker', [
    'exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function apiClient(key = SUPABASE_ANON_KEY) {
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(client: SupabaseClient, credentials: { email: string; password: string }) {
  expect((await client.auth.signInWithPassword(credentials)).error).toBeNull();
}

function importPayload(operations: Record<string, unknown>[]) {
  return {
    p_payload: {
      schemaVersion: 1, exchangeId: randomUUID(), exportedAt: '2026-10-11T00:00:00Z', operations,
    },
  };
}

const candidateArgs = { p_minimum_attempts: 0, p_maximum_accuracy: 1, p_maximum_question_count: 100 };

/** service roleはfixture準備専用。 */
async function seedOwnerData(ownerId: string, label: string, docId: string, text: string, answer: string) {
  const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, await seedSubject(ownerId, label), docId);
  const db = adminClient();
  const question = await db.from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId, question_text: text, model_answer: answer,
    choices: [], sort_order: 0, doubt_flag: true,
  }).select('id, version').single();
  if (question.error) throw question.error;
  const stats = await db.from('structured_question_stats').insert({
    owner_id: ownerId, question_id: question.data.id, asked_count: 4, correct_count: 0,
  });
  if (stats.error) throw stats.error;
  return { keywordId, question: question.data as { id: string; version: number } };
}

/** service roleは事後確認専用。 */
async function snapshot(ownerIds: string[]) {
  const result = await adminClient().from('structured_questions').select('*').in('owner_id', ownerIds).order('id');
  if (result.error) throw result.error;
  return result.data;
}

test.describe.serial('QuestionExchangeRpcSecurityConformance', () => {
  test('DB catalogの公開user-data RPCがRpcSecurityMatrixと過不足なく一致し、交換RPCを両方含む', () => {
    const catalog = JSON.parse(queryCatalog(PUBLIC_RPC_CATALOG_SQL)) as string[];
    expect(catalog).toEqual([...RPC_SECURITY_MATRIX].sort());
    for (const name of [CANDIDATES_RPC, IMPORT_RPC]) {
      expect(catalog.some((identity) => identity.startsWith(`${name}(`))).toBe(true);
    }
  });

  test('交換RPCはSECURITY INVOKER・空search_path・authenticated限定EXECUTEで、本文はschema修飾される', () => {
    for (const signature of Object.values(PUBLIC_SIGNATURES)) {
      const acl = JSON.parse(queryCatalog(`
        select jsonb_build_object(
          'schema', p.pronamespace::regnamespace::text, 'invoker', not p.prosecdef, 'config', p.proconfig,
          'publicExecute', has_function_privilege('public', p.oid, 'EXECUTE'),
          'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
          'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
          'serviceRoleExecute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
          'grantees', (select coalesce(jsonb_agg(distinct g.grantee::regrole::text), '[]')
            from aclexplode(p.proacl) g where g.privilege_type = 'EXECUTE' and g.grantee <> p.proowner))
        from pg_proc p where p.oid = '${signature}'::regprocedure;`));
      expect(acl, signature).toEqual({
        schema: 'public', invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false,
        authenticatedExecute: true, serviceRoleExecute: false, grantees: ['authenticated'],
      });
    }
    // 空search_pathでも動作するよう、本文が参照するuser-data tableはschema修飾されている
    const importBody = queryCatalog(`select prosrc from pg_proc where oid = '${PUBLIC_SIGNATURES[IMPORT_RPC]}'::regprocedure;`);
    expect(importBody).toContain(`private.${PRIMITIVE_NAME}(`);
    expect(importBody).toMatch(/public\.structured_questions/);
    const candidatesBody = queryCatalog(`select prosrc from pg_proc where oid = '${PUBLIC_SIGNATURES[CANDIDATES_RPC]}'::regprocedure;`);
    expect(candidatesBody).toMatch(/public\.structured_question/);
  });

  test('privateはPostgREST exposed schemas外で、primitiveはINVOKER・空search_path・正確なidentityとauthenticated限定権限を持つ', () => {
    const configSchemas = /^\s*schemas\s*=\s*\[([^\]]*)\]/m.exec(readFileSync('supabase/config.toml', 'utf8'));
    expect(configSchemas).not.toBeNull();
    const exposed = (configSchemas?.[1] ?? '').split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
    expect(exposed).not.toContain('private');
    expect(exposed).toContain('public');

    const primitive = JSON.parse(queryCatalog(`
      select jsonb_build_object(
        'identities', (select jsonb_agg(p.oid::regprocedure::text) from pg_proc p
          where p.pronamespace = 'private'::regnamespace and p.proname = '${PRIMITIVE_NAME}'),
        'args', pg_get_function_identity_arguments('${PRIMITIVE}'::regprocedure),
        'invoker', (select not prosecdef from pg_proc where oid = '${PRIMITIVE}'::regprocedure),
        'config', (select proconfig from pg_proc where oid = '${PRIMITIVE}'::regprocedure),
        'usage', jsonb_build_object(
          'authenticated', has_schema_privilege('authenticated', 'private', 'USAGE'),
          'anon', has_schema_privilege('anon', 'private', 'USAGE'),
          'public', has_schema_privilege('public', 'private', 'USAGE'),
          'serviceRole', has_schema_privilege('service_role', 'private', 'USAGE'),
          'authenticatedCreate', has_schema_privilege('authenticated', 'private', 'CREATE')),
        'execute', jsonb_build_object(
          'authenticated', has_function_privilege('authenticated', '${PRIMITIVE}', 'EXECUTE'),
          'anon', has_function_privilege('anon', '${PRIMITIVE}', 'EXECUTE'),
          'public', has_function_privilege('public', '${PRIMITIVE}', 'EXECUTE'),
          'serviceRole', has_function_privilege('service_role', '${PRIMITIVE}', 'EXECUTE')),
        'schemaGrantees', (select coalesce(jsonb_agg(distinct g.grantee::regrole::text), '[]')
          from pg_namespace n, aclexplode(n.nspacl) g
          where n.nspname = 'private' and g.privilege_type = 'USAGE' and g.grantee <> n.nspowner),
        'executeGrantees', (select coalesce(jsonb_agg(distinct g.grantee::regrole::text), '[]')
          from pg_proc p, aclexplode(p.proacl) g
          where p.oid = '${PRIMITIVE}'::regprocedure and g.privilege_type = 'EXECUTE' and g.grantee <> p.proowner));`));
    expect(primitive).toEqual({
      identities: [PRIMITIVE],
      args: 'p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb',
      invoker: true, config: ['search_path=""'],
      usage: { authenticated: true, anon: false, public: false, serviceRole: false, authenticatedCreate: false },
      execute: { authenticated: true, anon: false, public: false, serviceRole: false },
      schemaGrantees: ['authenticated'], executeGrantees: ['authenticated'],
    });

    // 実行中PostgRESTのdb-schemas設定（role/DB設定にある場合）にもprivateは含まれない
    const pgrst = queryCatalog(`
      select coalesce(string_agg(cfg, ','), '') from pg_db_role_setting s, unnest(s.setconfig) cfg
      where cfg like 'pgrst.db_schemas=%';`);
    expect(pgrst).not.toMatch(/\bprivate\b/);
  });

  test('owner成功・cross-owner非開示/無書込・anon拒否・service role拒否を交換RPCとprimitive委譲で満たす', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const otherCredentials = { email: `exchange-security-${randomUUID()}@example.com`, password: 'test-password-123' };
    const created = await adminClient().auth.admin.createUser({ ...otherCredentials, email_confirm: true });
    if (created.error) throw created.error;
    const otherId = created.data.user.id;
    try {
      const mine = await seedOwnerData(ownerId, 'xsec-owner', 'xs0001', '自分の交換設問', '答え');
      const foreign = await seedOwnerData(otherId, 'xsec-other', 'xs0002', SECRET_TEXT, SECRET_ANSWER);
      const owner = apiClient(); const other = apiClient(); const anon = apiClient();
      await signIn(owner, TEST_USER); await signIn(other, otherCredentials);
      const secrets = [SECRET_TEXT, SECRET_ANSWER, otherId, foreign.question.id, foreign.keywordId];

      // 候補RPC: ownerは自分の候補だけを得て、他利用者の内容を含まない
      const ownCandidates = await owner.rpc(CANDIDATES_RPC, candidateArgs);
      expect(ownCandidates.error).toBeNull();
      expect((ownCandidates.data as { keywordId: string }[]).map((t) => t.keywordId)).toEqual([mine.keywordId]);
      const ownSerialized = JSON.stringify(ownCandidates.data);
      for (const secret of secrets) expect(ownSerialized).not.toContain(secret);
      const otherCandidates = await other.rpc(CANDIDATES_RPC, candidateArgs);
      expect((otherCandidates.data as { keywordId: string }[]).map((t) => t.keywordId)).toEqual([foreign.keywordId]);

      const before = await snapshot([ownerId, otherId]);

      // import owner成功: 同一transactionでprimitiveへ委譲され、owner値はauth.uid()
      const ownImport = await owner.rpc(IMPORT_RPC, importPayload([
        { kind: 'create', keywordId: mine.keywordId, question: content },
        {
          kind: 'update', keywordId: mine.keywordId, questionId: mine.question.id, expectedVersion: mine.question.version,
          question: content, sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt'],
        },
      ]));
      expect(ownImport.error).toBeNull();
      expect(ownImport.data).toMatchObject({ createdCount: 1, updatedCount: 1, clearedDoubtCount: 1 });
      const afterOwner = await snapshot([ownerId, otherId]);
      expect(afterOwner.filter((r) => r.owner_id === otherId)).toEqual(before.filter((r) => r.owner_id === otherId));
      expect(afterOwner.filter((r) => r.owner_id === ownerId)).toHaveLength(2);

      // cross-owner: 他ownerのkeyword/questionはprimitive委譲前後の再検証で拒否され、非開示・無書込
      for (const operation of [
        { kind: 'create', keywordId: foreign.keywordId, question: content },
        {
          kind: 'update', keywordId: foreign.keywordId, questionId: foreign.question.id,
          expectedVersion: foreign.question.version, question: content, sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt'],
        },
      ]) {
        const cross = await owner.rpc(IMPORT_RPC, importPayload([operation]));
        expect(cross.error).not.toBeNull();
        const serialized = JSON.stringify({ data: cross.data, error: cross.error });
        for (const secret of [SECRET_TEXT, SECRET_ANSWER, otherId]) expect(serialized).not.toContain(secret);
        expect(await snapshot([ownerId, otherId])).toEqual(afterOwner);
      }

      // anon: 公開RPCは実行拒否
      for (const [name, args] of [[CANDIDATES_RPC, candidateArgs], [IMPORT_RPC, importPayload([
        { kind: 'create', keywordId: mine.keywordId, question: content },
      ])]] as const) {
        const denied = await anon.rpc(name, args);
        expect(denied.error, name).not.toBeNull();
        expect(denied.data).toBeNull();
        expect(JSON.stringify(denied.error)).toMatch(/permission denied|42501/);
      }

      // service role: setup/事後確認専用で、利用者RPCの実行主体にはならない
      const service = adminClient();
      for (const [name, args] of [[CANDIDATES_RPC, candidateArgs], [IMPORT_RPC, importPayload([
        { kind: 'create', keywordId: mine.keywordId, question: content },
      ])]] as const) {
        const denied = await service.rpc(name, args);
        expect(denied.error, name).not.toBeNull();
        expect(denied.data).toBeNull();
      }
      expect(await snapshot([ownerId, otherId])).toEqual(afterOwner);

      // primitiveをREST/RPCで直接指定しても、anon/authenticated/service roleのいずれからも到達できない
      const primitiveArgs = {
        p_question_id: mine.question.id, p_keyword_id: mine.keywordId, p_expected_version: mine.question.version + 1,
        p_content: { question_text: '直接', model_answer: '直接', choices: [] }, p_flag_patch: {},
      };
      for (const [label, client] of [['anon', anon], ['authenticated', owner], ['service_role', service]] as const) {
        const viaPublic = await client.rpc(PRIMITIVE_NAME, primitiveArgs);
        expect(viaPublic.error, `${label} public`).not.toBeNull();
        expect(viaPublic.data).toBeNull();
        const viaPrivate = await client.schema('private').rpc(PRIMITIVE_NAME, primitiveArgs);
        expect(viaPrivate.error, `${label} private`).not.toBeNull();
        expect(viaPrivate.data).toBeNull();
        expect(JSON.stringify(viaPrivate.error)).toMatch(/PGRST106|schema|Invalid/i);
      }
      expect(await snapshot([ownerId, otherId])).toEqual(afterOwner);

      // 通常read: 交換で扱う設問・statsはowner境界内だけが見える
      for (const [table, column] of [['structured_questions', 'id'], ['structured_question_stats', 'question_id']] as const) {
        const crossRead = await owner.from(table).select('*').eq(column, foreign.question.id);
        expect(crossRead.error).toBeNull();
        expect(crossRead.data).toEqual([]);
        const anonRead = await anon.from(table).select('*');
        if (anonRead.error === null) expect(anonRead.data).toEqual([]);
      }
    } finally {
      await resetData(otherId); await adminClient().auth.admin.deleteUser(otherId); await resetData(ownerId);
    }
  });
});
