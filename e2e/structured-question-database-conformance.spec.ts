import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';
import {
  invalidQuestionContentCases,
  questionContent,
  validQuestionContentCases,
} from './question-bank-conformance-fixtures';

type QuestionRow = {
  id: string;
  question_text: string;
  sort_order: number;
  version: number;
  updated_at: string;
  doubt_flag: boolean;
  explanation_request_flag: boolean;
};

type MutationResult = {
  kind: 'saved' | 'version-conflict';
  question?: QuestionRow;
  current?: QuestionRow;
};

function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function callPrimitive(input: {
  ownerId: string;
  questionId: string;
  keywordId: string;
  expectedVersion: number | null;
  content: Record<string, unknown> | null;
  flagPatch?: Record<string, unknown>;
}): MutationResult {
  const expectedVersion = input.expectedVersion === null ? 'null' : String(input.expectedVersion);
  const content = input.content === null
    ? 'null'
    : `'${sqlLiteral(JSON.stringify(input.content))}'::jsonb`;
  const flagPatch = `'${sqlLiteral(JSON.stringify(input.flagPatch ?? {}))}'::jsonb`;
  const sql = [
    'begin',
    'set local role authenticated',
    `select set_config('request.jwt.claim.sub', '${input.ownerId}', true)`,
    `select private.apply_structured_question_content(` +
      `'${input.questionId}'::uuid, '${input.keywordId}'::uuid, ${expectedVersion}, ` +
      `${content}, ${flagPatch})`,
    'commit',
  ].join('; ');
  const output = execFileSync(
    'docker',
    ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql],
    { encoding: 'utf8' },
  ).trim().split(/\r?\n/);
  const result = output.find((line) => line.startsWith('{'));
  if (!result) throw new Error(`primitive result was not returned: ${output.join('\n')}`);
  return JSON.parse(result) as MutationResult;
}

test.describe.serial('QuestionDatabaseConformance', () => {
  test('章削除では設問を保持し、keyword削除ではcascadeする', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '参照整合性');
    const { chapterId, keywordId, materialId } = await seedMaterialWithKeyword(
      ownerId, subjectId, 'qdb001',
    );
    const inserted = await adminClient().from('structured_questions').insert({
      owner_id: ownerId,
      material_id: materialId,
      keyword_id: keywordId,
      question_text: '参照整合性',
      model_answer: '保持',
    }).select('id').single();
    expect(inserted.error).toBeNull();

    expect((await adminClient().from('chapters').delete().eq('id', chapterId)).error).toBeNull();
    const keywordAfterChapterDelete = await adminClient().from('keywords')
      .select('chapter_id').eq('id', keywordId).single();
    expect(keywordAfterChapterDelete.data).toEqual({ chapter_id: null });
    expect((await adminClient().from('structured_questions').select('id')
      .eq('id', inserted.data!.id)).data).toEqual([{ id: inserted.data!.id }]);

    expect((await adminClient().from('keywords').delete().eq('id', keywordId)).error).toBeNull();
    expect((await adminClient().from('structured_questions').select('id')
      .eq('id', inserted.data!.id)).data).toEqual([]);
  });

  test('service-role seedでもownerまたはmaterialがkeywordと不一致の設問を作れない', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '複合参照');
    const first = await seedMaterialWithKeyword(ownerId, subjectId, 'qdb002');
    const second = await seedMaterialWithKeyword(ownerId, subjectId, 'qdb003');
    const otherEmail = `question-db-${randomUUID()}@example.com`;
    const other = await adminClient().auth.admin.createUser({
      email: otherEmail, password: 'test-password-123', email_confirm: true,
    });
    if (other.error) throw other.error;
    try {
      const base = {
        keyword_id: first.keywordId,
        material_id: first.materialId,
        owner_id: ownerId,
        question_text: '複合参照',
        model_answer: '拒否',
      };
      const materialMismatch = await adminClient().from('structured_questions')
        .insert({ ...base, material_id: second.materialId });
      expect(materialMismatch.error?.code).toBe('23503');

      const ownerMismatch = await adminClient().from('structured_questions')
        .insert({ ...base, owner_id: other.data.user.id });
      expect(ownerMismatch.error?.code).toBe('23503');
    } finally {
      await adminClient().auth.admin.deleteUser(other.data.user.id);
      await resetData(ownerId);
    }
  });

  test('同じ期待版の内容更新は一方だけ成功し、敗者は現在版を返す', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '二重更新');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'qdb004');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await client.auth.signInWithPassword(TEST_USER)).error).toBeNull();
    const created = await client.rpc('mutate_structured_question', {
      p_command: 'create', p_keyword_id: keywordId, p_content: questionContent('初期'),
    });
    expect(created.error).toBeNull();
    const question = (created.data as MutationResult).question!;

    const updates = await Promise.all(['更新A', '更新B'].map((label) =>
      client.rpc('mutate_structured_question', {
        p_command: 'update-content', p_question_id: question.id,
        p_expected_version: question.version, p_content: questionContent(label),
      })));
    expect(updates.every(({ error }) => error === null)).toBe(true);
    expect(updates.map(({ data }) => (data as MutationResult).kind).sort()).toEqual([
      'saved', 'version-conflict',
    ]);
    const stored = await adminClient().from('structured_questions')
      .select('question_text,version').eq('id', question.id).single();
    expect(stored.data?.version).toBe(question.version + 1);
    expect(['更新Aとは何か', '更新Bとは何か']).toContain(stored.data?.question_text);
    const conflict = updates.find(({ data }) => (data as MutationResult).kind === 'version-conflict');
    expect((conflict?.data as MutationResult).current).toMatchObject(stored.data!);
  });

  test('並べ替えはstale時に全行不変、成功時に順序・版・更新時刻を全行更新する', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '並べ替え適合');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'qdb005');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await client.auth.signInWithPassword(TEST_USER)).error).toBeNull();
    const rows: QuestionRow[] = [];
    for (const label of ['A', 'B', 'C']) {
      const result = await client.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: keywordId, p_content: questionContent(label),
      });
      expect(result.error).toBeNull();
      rows.push((result.data as MutationResult).question!);
    }
    const read = async () => {
      const result = await adminClient().from('structured_questions')
        .select('id,question_text,sort_order,version,updated_at,doubt_flag,explanation_request_flag')
        .eq('keyword_id', keywordId).order('sort_order').order('id');
      if (result.error) throw result.error;
      return result.data as QuestionRow[];
    };
    const baseline = await read();
    const reversed = [...baseline].reverse();
    const stale = await client.rpc('reorder_structured_questions', {
      p_keyword_id: keywordId,
      p_ordered: reversed.map(({ id, version }, index) => ({
        id, version: index === 1 ? version - 1 : version,
      })),
    });
    expect(stale.data).toMatchObject({ kind: 'version-conflict' });
    expect(await read()).toEqual(baseline);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const saved = await client.rpc('reorder_structured_questions', {
      p_keyword_id: keywordId,
      p_ordered: reversed.map(({ id, version }) => ({ id, version })),
    });
    expect(saved.error).toBeNull();
    const after = await read();
    expect(after.map(({ id, sort_order }) => ({ id, sort_order }))).toEqual(
      reversed.map(({ id }, sort_order) => ({ id, sort_order })),
    );
    for (const row of after) {
      const before = baseline.find(({ id }) => id === row.id)!;
      expect(row.version).toBe(before.version + 1);
      expect(new Date(row.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    }
  });

  test('共有fixtureで公開編集とprivate primitiveの検証・版・flag保持が一致する', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '共有fixture');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'qdb006');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await client.auth.signInWithPassword(TEST_USER)).error).toBeNull();

    for (const fixture of validQuestionContentCases) {
      const publicCreated = await client.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: keywordId, p_content: questionContent(`公開-${fixture.name}`),
      });
      expect(publicCreated.error).toBeNull();
      const publicQuestion = (publicCreated.data as MutationResult).question!;
      const publicFlags = await client.rpc('mutate_structured_question', {
        p_command: 'set-flags', p_question_id: publicQuestion.id,
        p_expected_version: publicQuestion.version,
        p_flag_patch: { doubt_flag: true, explanation_request_flag: true },
      });
      const publicFlagged = (publicFlags.data as MutationResult).question!;

      const privateId = randomUUID();
      callPrimitive({
        ownerId, questionId: privateId, keywordId, expectedVersion: null,
        content: questionContent(`private-${fixture.name}`), flagPatch: { __create: true },
      });
      const privateFlagged = callPrimitive({
        ownerId, questionId: privateId, keywordId, expectedVersion: 1,
        content: null, flagPatch: { doubt_flag: true, explanation_request_flag: true },
      }).question!;

      const publicUpdated = await client.rpc('mutate_structured_question', {
        p_command: 'update-content', p_question_id: publicQuestion.id,
        p_expected_version: publicFlagged.version, p_content: fixture.content,
      });
      expect(publicUpdated.error, fixture.name).toBeNull();
      const privateUpdated = callPrimitive({
        ownerId, questionId: privateId, keywordId,
        expectedVersion: privateFlagged.version, content: fixture.content,
      });
      for (const result of [publicUpdated.data as MutationResult, privateUpdated]) {
        expect(result).toMatchObject({
          kind: 'saved',
          question: {
            ...fixture.expected,
            version: 3,
            doubt_flag: true,
            explanation_request_flag: true,
          },
        });
      }
    }

    for (const fixture of invalidQuestionContentCases) {
      const publicCreated = await client.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: keywordId, p_content: questionContent(`公開-invalid-${fixture.name}`),
      });
      const publicQuestion = (publicCreated.data as MutationResult).question!;
      const privateId = randomUUID();
      callPrimitive({
        ownerId, questionId: privateId, keywordId, expectedVersion: null,
        content: questionContent(`private-invalid-${fixture.name}`), flagPatch: { __create: true },
      });

      const publicRejected = await client.rpc('mutate_structured_question', {
        p_command: 'update-content', p_question_id: publicQuestion.id,
        p_expected_version: 1, p_content: fixture.content,
      });
      expect(publicRejected.error, `public: ${fixture.name}`).not.toBeNull();
      expect(() => callPrimitive({
        ownerId, questionId: privateId, keywordId, expectedVersion: 1, content: fixture.content,
      }), `private: ${fixture.name}`).toThrow();

      const unchanged = await adminClient().from('structured_questions')
        .select('version').in('id', [publicQuestion.id, privateId]).order('id');
      expect(unchanged.data).toEqual([{ version: 1 }, { version: 1 }]);
    }
  });
});
