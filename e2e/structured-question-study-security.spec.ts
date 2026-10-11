import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';
import { PUBLIC_RPC_CATALOG_SQL, RPC_SECURITY_MATRIX } from './rpc-security-matrix';

const RECORD_RPC = 'record_structured_question_answer';
const RECORD_SIGNATURE = 'public.record_structured_question_answer(uuid,bigint,text,text,timestamptz)';
const SECRET_TEXT = '他人に見せてはいけない設問本文';
const SECRET_ANSWER = '他人の模範解答';

function queryCatalog(sql: string): string {
  return execFileSync('docker', [
    'exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql,
  ], { encoding: 'utf8' }).trim();
}

function apiClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(client: SupabaseClient, credentials: { email: string; password: string }) {
  expect((await client.auth.signInWithPassword(credentials)).error).toBeNull();
}

/** service roleはfixture準備専用。 */
async function seedQuestion(ownerId: string, label: string, docId: string, text: string, answer: string) {
  const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, await seedSubject(ownerId, label), docId);
  const result = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId,
    question_text: text, model_answer: answer, sort_order: 0,
  }).select('id, version').single();
  if (result.error) throw result.error;
  return result.data as { id: string; version: number };
}

/** service roleは事後確認専用。 */
async function persisted(questionId: string) {
  const db = adminClient();
  const [logs, stats] = await Promise.all([
    db.from('structured_question_answer_logs').select('*').eq('question_id', questionId).order('answered_at'),
    db.from('structured_question_stats').select('*').eq('question_id', questionId),
  ]);
  if (logs.error) throw logs.error;
  if (stats.error) throw stats.error;
  return { logs: logs.data, stats: stats.data };
}

function recordArgs(question: { id: string; version: number }, answer: string) {
  return {
    p_question_id: question.id, p_expected_question_version: question.version,
    p_answer: answer, p_mode: 'written', p_answered_at: new Date().toISOString(),
  };
}

test.describe.serial('QuestionStudyRpcSecurityConformance', () => {
  test('DB catalogの公開user-data RPCがRpcSecurityMatrixと過不足なく一致し、回答記録RPCを含む', () => {
    const catalog = JSON.parse(queryCatalog(PUBLIC_RPC_CATALOG_SQL)) as string[];
    expect(catalog).toEqual([...RPC_SECURITY_MATRIX].sort());
    expect(catalog.some((identity) => identity.startsWith(`${RECORD_RPC}(`))).toBe(true);
  });

  test('回答記録RPCのEXECUTE grantはauthenticatedだけに限定され、SECURITY INVOKERで固定search_pathを持つ', () => {
    const acl = JSON.parse(queryCatalog(`
      select jsonb_build_object(
        'invoker', not p.prosecdef, 'config', p.proconfig,
        'publicExecute', has_function_privilege('public', p.oid, 'EXECUTE'),
        'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'serviceRoleExecute', has_function_privilege('service_role', p.oid, 'EXECUTE'))
      from pg_proc p where p.oid = '${RECORD_SIGNATURE}'::regprocedure;`));
    expect(acl).toEqual({
      invoker: true, config: ['search_path=""'], publicExecute: false,
      anonExecute: false, authenticatedExecute: true, serviceRoleExecute: false,
    });
    const grantees = JSON.parse(queryCatalog(`
      select coalesce(jsonb_agg(distinct grantee), '[]') from information_schema.role_routine_grants
      where routine_schema = 'public' and routine_name = '${RECORD_RPC}' and privilege_type = 'EXECUTE'
        and grantee <> 'postgres';`));
    expect(grantees).toEqual(['authenticated']);
    const tables = JSON.parse(queryCatalog(`
      select jsonb_object_agg(t, jsonb_build_object(
        'anonSelect', has_table_privilege('anon', 'public.' || t, 'SELECT'),
        'anonInsert', has_table_privilege('anon', 'public.' || t, 'INSERT'),
        'rls', (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass)))
      from unnest(array['structured_question_stats','structured_question_answer_logs']) t;`));
    expect(tables).toEqual({
      structured_question_stats: { anonSelect: false, anonInsert: false, rls: true },
      structured_question_answer_logs: { anonSelect: false, anonInsert: false, rls: true },
    });
  });

  test('owner成功・cross-owner拒否・anon拒否を満たし、通常読取とRPCが他利用者の設問・履歴・statsを漏らさない', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const otherCredentials = { email: `study-security-${randomUUID()}@example.com`, password: 'test-password-123' };
    const created = await adminClient().auth.admin.createUser({ ...otherCredentials, email_confirm: true });
    if (created.error) throw created.error;
    const otherId = created.data.user.id;
    try {
      const own = await seedQuestion(ownerId, 'study-sec-owner', 'sqs001', '自分の設問', '答え');
      const foreign = await seedQuestion(otherId, 'study-sec-other', 'sqs002', SECRET_TEXT, SECRET_ANSWER);
      const owner = apiClient(); const other = apiClient(); const anon = apiClient();
      await signIn(owner, TEST_USER); await signIn(other, otherCredentials);

      // 他利用者が自分の設問へ記録し、漏洩対象の履歴とstatsを作る
      const foreignRecorded = await other.rpc(RECORD_RPC, recordArgs(foreign, SECRET_ANSWER));
      expect(foreignRecorded.error).toBeNull();
      expect(foreignRecorded.data).toMatchObject({ kind: 'recorded' });
      const foreignBefore = await persisted(foreign.id);
      expect(foreignBefore.logs).toHaveLength(1);
      expect(foreignBefore.stats).toHaveLength(1);

      // owner成功
      const ownRecorded = await owner.rpc(RECORD_RPC, recordArgs(own, '答え'));
      expect(ownRecorded.error).toBeNull();
      expect(ownRecorded.data).toMatchObject({ kind: 'recorded' });
      const ownAfter = await persisted(own.id);
      expect(ownAfter.logs).toHaveLength(1);
      expect(ownAfter.logs[0]).toMatchObject({ owner_id: ownerId, is_correct: true });
      expect(ownAfter.stats).toEqual([expect.objectContaining({ owner_id: ownerId, asked_count: 1, correct_count: 1 })]);

      // cross-owner拒否: 内容を漏らさず、何も書かない
      const cross = await owner.rpc(RECORD_RPC, recordArgs(foreign, SECRET_ANSWER));
      const serialized = JSON.stringify({ data: cross.data, error: cross.error });
      for (const secret of [SECRET_TEXT, SECRET_ANSWER, otherId, `"version":${foreign.version}`]) {
        expect(serialized).not.toContain(secret);
      }
      if (cross.error === null) expect(cross.data).not.toMatchObject({ kind: 'recorded' });
      expect(await persisted(foreign.id)).toEqual(foreignBefore);

      // anon拒否
      const anonCall = await anon.rpc(RECORD_RPC, recordArgs(own, '答え'));
      expect(anonCall.error).not.toBeNull();
      expect(JSON.stringify(anonCall.error)).toMatch(/permission denied|42501/);
      for (const table of ['structured_question_stats', 'structured_question_answer_logs', 'structured_questions'] as const) {
        const read = await anon.from(table).select('*');
        if (read.error === null) expect(read.data).toEqual([]);
      }
      expect(await persisted(own.id)).toEqual(ownAfter);

      // 通常読取: authenticatedは他利用者の設問・履歴・statsを読めない
      for (const [table, column] of [
        ['structured_questions', 'id'], ['structured_question_stats', 'question_id'],
        ['structured_question_answer_logs', 'question_id'],
      ] as const) {
        const crossRead = await owner.from(table).select('*').eq(column, foreign.id);
        expect(crossRead.error).toBeNull();
        expect(crossRead.data).toEqual([]);
        const all = await owner.from(table).select('owner_id');
        expect(all.error).toBeNull();
        expect((all.data ?? []).every((row) => (row as { owner_id: string }).owner_id === ownerId)).toBe(true);
      }

      // 直接書込でも他利用者の履歴・statsを作成・改変できない
      const forgedLog = await owner.from('structured_question_answer_logs').insert({
        owner_id: otherId, question_id: foreign.id, answer: 'x', is_correct: true, mode: 'written',
      });
      expect(forgedLog.error).not.toBeNull();
      const forgedStats = await owner.from('structured_question_stats')
        .update({ asked_count: 99 }).eq('question_id', foreign.id).select('question_id');
      expect(forgedStats.data ?? []).toEqual([]);
      expect(await persisted(foreign.id)).toEqual(foreignBefore);
    } finally {
      await resetData(otherId); await adminClient().auth.admin.deleteUser(otherId); await resetData(ownerId);
    }
  });
});
