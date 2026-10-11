import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

type MutationResponse = {
  kind: 'saved' | 'version-conflict' | 'deleted';
  question?: { id: string; version: number; question_text: string; doubt_flag: boolean };
  current?: { version: number; question_text: string; doubt_flag: boolean };
};

const cases = JSON.parse(
  readFileSync('supabase/tests/fixtures/structured_question_mutation_cases.json', 'utf8'),
) as Array<{
  name: string;
  valid: boolean;
  content: Record<string, unknown>;
  expected?: Record<string, unknown>;
}>;
const validCases = cases.filter((fixture) => fixture.valid);
const invalidCases = cases.filter((fixture) => !fixture.valid);

function callPrimitive(input: {
  ownerId: string;
  questionId: string;
  keywordId: string;
  content: Record<string, unknown>;
}): MutationResponse {
  const content = JSON.stringify(input.content).replaceAll("'", "''");
  const sql = [
    `select set_config('request.jwt.claim.sub', '${input.ownerId}', false)`,
    `select private.apply_structured_question_content('${input.questionId}'::uuid, ` +
      `'${input.keywordId}'::uuid, null, '${content}'::jsonb, '{"__create":true}'::jsonb)`,
  ].join('; ');
  const output = execFileSync(
    'docker',
    ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql],
    { encoding: 'utf8' },
  ).trim().split(/\r?\n/).at(-1);
  return JSON.parse(output ?? '') as MutationResponse;
}

test.describe.serial('structured question mutation RPC', () => {
  test('rejects fields owned by another command and create with an existing id', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, 'RPC入力分離');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'rpc002');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword(TEST_USER);
    const created = await client.rpc('mutate_structured_question', {
      p_command: 'create', p_keyword_id: keywordId, p_content: validCases[0]!.content,
    });
    const id = (created.data as MutationResponse).question!.id;

    const forbiddenInputs = [
      { p_command: 'update-content', p_question_id: id, p_expected_version: 1,
        p_content: validCases[0]!.content, p_flag_patch: { doubt_flag: true } },
      { p_command: 'set-flags', p_question_id: id, p_expected_version: 1,
        p_content: validCases[0]!.content, p_flag_patch: { doubt_flag: true } },
      { p_command: 'set-flags', p_question_id: id, p_expected_version: 1,
        p_flag_patch: { doubt_flag: true, __delete: true } },
      { p_command: 'set-active', p_question_id: id, p_expected_version: 1,
        p_flag_patch: { is_active: false, doubt_flag: true } },
      { p_command: 'delete', p_question_id: id, p_expected_version: 1,
        p_flag_patch: { doubt_flag: true } },
      { p_command: 'create', p_question_id: id, p_keyword_id: keywordId,
        p_content: validCases[0]!.content },
      { p_command: 'create', p_keyword_id: keywordId,
        p_content: validCases[0]!.content, p_flag_patch: { __create: true } },
    ];
    for (const input of forbiddenInputs) {
      const result = await client.rpc('mutate_structured_question', input);
      expect(result.error, JSON.stringify(input)).not.toBeNull();
    }
    const unchanged = await adminClient().from('structured_questions')
      .select('version,doubt_flag,is_active').eq('id', id).single();
    expect(unchanged.data).toEqual({ version: 1, doubt_flag: false, is_active: true });
  });

  test('shared drafts, flags, stale writes, active state, and deletion obey one atomic contract', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, 'RPC適合');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'rpc001');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await client.auth.signInWithPassword(TEST_USER);
    expect(signedIn.error).toBeNull();

    for (const fixture of validCases) {
      const created = await client.rpc('mutate_structured_question', {
        p_command: 'create',
        p_keyword_id: keywordId,
        p_content: fixture.content,
      });
      expect(created.error, fixture.name).toBeNull();
      const result = created.data as MutationResponse;
      expect(result.kind).toBe('saved');
      expect(result.question).toMatchObject({ ...fixture.expected!, version: 1 });

      const primitive = callPrimitive({
        ownerId,
        questionId: randomUUID(),
        keywordId,
        content: fixture.content,
      });
      expect(primitive).toMatchObject({
        kind: 'saved',
        question: {
          ...fixture.expected!, version: 1, doubt_flag: false,
          explanation_request_flag: false, is_active: true,
        },
      });

      const id = result.question!.id;
      const flags = await client.rpc('mutate_structured_question', {
        p_command: 'set-flags', p_question_id: id, p_expected_version: 1,
        p_flag_patch: { doubt_flag: true },
      });
      expect(flags.error).toBeNull();
      expect(flags.data).toMatchObject({ kind: 'saved', question: { version: 2, doubt_flag: true } });

      const stale = await client.rpc('mutate_structured_question', {
        p_command: 'update-content', p_question_id: id,
        p_expected_version: 1,
        p_content: { ...fixture.content, question_text: '上書きされない' },
      });
      expect(stale.error).toBeNull();
      expect(stale.data).toMatchObject({
        kind: 'version-conflict', current: { version: 2, question_text: fixture.expected!.question_text },
      });

      const updated = await client.rpc('mutate_structured_question', {
        p_command: 'update-content', p_question_id: id,
        p_expected_version: 2, p_content: fixture.content,
      });
      expect(updated.data).toMatchObject({
        kind: 'saved', question: { version: 3, doubt_flag: true },
      });

      const concurrent = await Promise.all([
        client.rpc('mutate_structured_question', {
          p_command: 'set-active', p_question_id: id, p_expected_version: 3,
          p_flag_patch: { is_active: false },
        }),
        client.rpc('mutate_structured_question', {
          p_command: 'set-active', p_question_id: id, p_expected_version: 3,
          p_flag_patch: { is_active: false },
        }),
      ]);
      expect(concurrent.map(({ data }) => (data as MutationResponse).kind).sort()).toEqual([
        'saved', 'version-conflict',
      ]);

      const inactive = concurrent.find(({ data }) => (data as MutationResponse).kind === 'saved');
      expect(inactive?.data).toMatchObject({ kind: 'saved', question: { version: 4 } });

      const deleted = await client.rpc('mutate_structured_question', {
        p_command: 'delete', p_question_id: id, p_expected_version: 4,
      });
      expect(deleted.data).toEqual({ kind: 'deleted', id, version: 4 });
      const remaining = await adminClient().from('structured_questions').select('id').eq('id', id);
      expect(remaining.data).toEqual([]);
    }

    for (const fixture of invalidCases) {
      const publicResult = await client.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: keywordId, p_content: fixture.content,
      });
      expect(publicResult.error, `public: ${fixture.name}`).not.toBeNull();
      expect(
        () => callPrimitive({
          ownerId, questionId: randomUUID(), keywordId, content: fixture.content,
        }),
        `primitive: ${fixture.name}`,
      ).toThrow();
    }
  });
});
