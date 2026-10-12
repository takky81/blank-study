import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  test('doubt note follows the doubt flag through set-flags and content updates', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, 'RPC疑義メモ');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'rpc003');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword(TEST_USER);
    const content = validCases[0]!.content;
    const created = await client.rpc('mutate_structured_question', {
      p_command: 'create', p_keyword_id: keywordId, p_content: content,
    });
    const id = (created.data as MutationResponse).question!.id;
    const row = async () => (await adminClient().from('structured_questions')
      .select('version,doubt_flag,doubt_note').eq('id', id).single()).data;
    const setFlags = (version: number, patch: Record<string, unknown>) => client.rpc('mutate_structured_question', {
      p_command: 'set-flags', p_question_id: id, p_expected_version: version, p_flag_patch: patch,
    });

    // note without a resulting doubt flag, non-string note, and unknown keys are rejected
    for (const patch of [{ doubt_note: 'メモ' }, { doubt_flag: false, doubt_note: 'メモ' },
      { doubt_flag: true, doubt_note: 1 }, { doubt_flag: true, doubt_note: 'x'.repeat(1001) },
      { doubt_flag: true, unknown: 'x' }]) {
      expect((await setFlags(1, patch)).error, JSON.stringify(patch)).not.toBeNull();
    }
    expect(await row()).toEqual({ version: 1, doubt_flag: false, doubt_note: null });

    expect((await setFlags(1, { doubt_flag: true, doubt_note: '  定義が違う  ' })).error).toBeNull();
    expect(await row()).toEqual({ version: 2, doubt_flag: true, doubt_note: '定義が違う' });
    expect((await client.rpc('mutate_structured_question', {
      p_command: 'update-content', p_question_id: id, p_expected_version: 2, p_content: content,
    })).error).toBeNull();
    expect(await row()).toEqual({ version: 3, doubt_flag: true, doubt_note: '定義が違う' });
    expect((await setFlags(3, { doubt_flag: true, doubt_note: '   ' })).error).toBeNull();
    expect(await row()).toEqual({ version: 4, doubt_flag: true, doubt_note: null });
    expect((await setFlags(4, { doubt_flag: true, doubt_note: '再メモ' })).error).toBeNull();
    expect((await setFlags(5, { doubt_flag: false })).error).toBeNull();
    expect(await row()).toEqual({ version: 6, doubt_flag: false, doubt_note: null });
  });

  test('doubt reasons are canonical, validated, and follow the doubt flag', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, 'RPC疑義理由');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'rpc004');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword(TEST_USER);
    const content = validCases[0]!.content;
    const created = await client.rpc('mutate_structured_question', {
      p_command: 'create', p_keyword_id: keywordId, p_content: content,
    });
    const id = (created.data as MutationResponse).question!.id;
    const row = async () => (await adminClient().from('structured_questions')
      .select('version,doubt_flag,doubt_reasons').eq('id', id).single()).data;
    const setFlags = (version: number, patch: Record<string, unknown>) => client.rpc('mutate_structured_question', {
      p_command: 'set-flags', p_question_id: id, p_expected_version: version, p_flag_patch: patch,
    });

    for (const patch of [{ doubt_reasons: ['low_value'] }, { doubt_flag: false, doubt_reasons: ['low_value'] },
      { doubt_flag: true, doubt_reasons: ['unknown'] }, { doubt_flag: true, doubt_reasons: [1] },
      { doubt_flag: true, doubt_reasons: 'low_value' }, { doubt_flag: true, doubt_reasons: null }]) {
      const result = await setFlags(1, patch);
      expect(result.error, JSON.stringify(patch)).not.toBeNull();
      expect(result.error!.code, JSON.stringify(patch)).toBe('22023');
    }
    expect(await row()).toEqual({ version: 1, doubt_flag: false, doubt_reasons: [] });

    expect((await setFlags(1, { doubt_flag: true, doubt_reasons: ['unclear', 'answer_guessable', 'unclear'] })).error).toBeNull();
    expect(await row()).toEqual({ version: 2, doubt_flag: true, doubt_reasons: ['answer_guessable', 'unclear'] });
    expect((await client.rpc('mutate_structured_question', {
      p_command: 'update-content', p_question_id: id, p_expected_version: 2, p_content: content,
    })).error).toBeNull();
    expect((await setFlags(3, { explanation_request_flag: true })).error).toBeNull();
    expect(await row()).toEqual({ version: 4, doubt_flag: true, doubt_reasons: ['answer_guessable', 'unclear'] });
    expect((await setFlags(4, { doubt_flag: true, doubt_reasons: [] })).error).toBeNull();
    expect(await row()).toEqual({ version: 5, doubt_flag: true, doubt_reasons: [] });
    // weak_distractors was merged into answer_guessable and is no longer accepted
    expect((await setFlags(5, { doubt_flag: true, doubt_reasons: ['weak_distractors'] })).error?.code).toBe('22023');
    expect((await setFlags(5, { doubt_flag: true, doubt_reasons: ['defective', 'unclear', 'low_value'] })).error).toBeNull();
    expect(await row()).toEqual({ version: 6, doubt_flag: true, doubt_reasons: ['low_value', 'defective', 'unclear'] });
    expect((await setFlags(6, { doubt_flag: false })).error).toBeNull();
    expect(await row()).toEqual({ version: 7, doubt_flag: false, doubt_reasons: [] });
    // the table check rejects direct writes that bypass the RPC
    expect((await adminClient().from('structured_questions').update({ doubt_reasons: ['low_value'] }).eq('id', id)).error).not.toBeNull();
    expect((await adminClient().from('structured_questions').update({ doubt_flag: true, doubt_reasons: ['low_value', 'low_value'] }).eq('id', id)).error).not.toBeNull();
  });

  test('the merge migration converts existing weak_distractors rows without bumping version', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, 'RPC疑義理由統合');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'rpc005');
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const questionId of ids) {
      callPrimitive({ ownerId, questionId, keywordId, content: validCases[0]!.content });
    }
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261012020000_merge_doubt_reason_weak_distractors.sql'), 'utf8');
    const normalization = migration.slice(
      migration.indexOf('alter table public.structured_questions disable trigger'),
      migration.indexOf('enable trigger structured_questions_set_version;') + 'enable trigger structured_questions_set_version;'.length,
    );
    expect(normalization).toContain('update public.structured_questions');
    const legacy = ['{weak_distractors}', '{answer_guessable,weak_distractors}', '{low_value,weak_distractors,unclear}'];
    const sql = [
      'begin',
      'alter table public.structured_questions drop constraint structured_questions_doubt_reasons_check',
      'alter table public.structured_questions disable trigger structured_questions_set_version',
      ...ids.map((qid, i) => `update public.structured_questions set doubt_flag = true, doubt_reasons = '${legacy[i]}' where id = '${qid}'`),
      'alter table public.structured_questions enable trigger structured_questions_set_version',
      normalization,
      `select string_agg(id::text || '=' || version || ':' || array_to_string(doubt_reasons, ','), ' ' order by id) from public.structured_questions where id in (${ids.map((qid) => `'${qid}'`).join(',')})`,
      'rollback',
    ].join(';\n');
    const output = execFileSync(
      'docker',
      ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
      { encoding: 'utf8' },
    );
    const expected = ['answer_guessable', 'answer_guessable', 'answer_guessable,low_value,unclear'];
    for (const [i, qid] of ids.entries()) expect(output).toContain(`${qid}=1:${expected[i]}`);

    // after the real migration no row keeps the old code and the check rejects it
    const remaining = execFileSync('docker', ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c',
      "select count(*) from public.structured_questions where 'weak_distractors' = any(doubt_reasons)"], { encoding: 'utf8' }).trim();
    expect(remaining).toBe('0');
    expect((await adminClient().from('structured_questions').update({ doubt_flag: true, doubt_reasons: ['weak_distractors'] })
      .eq('id', ids[0]!)).error).not.toBeNull();
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
