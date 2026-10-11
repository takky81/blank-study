import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

type QuestionRow = {
  id: string;
  keyword_id: string;
  sort_order: number;
  version: number;
  updated_at: string;
  is_active: boolean;
};

const content = (label: string) => ({
  question_text: `${label}とは何か`,
  model_answer: `${label}の答え`,
  choices: [],
  explanation: null,
});

function execSql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' },
  );
}

test.describe.serial('structured question reorder RPC', () => {
  test('serializes a concurrent create against the complete keyword set', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '並行集合ロック');
    const { keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'kr0003');
    const createClientSession = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const createSession = createClientSession();
    const reorderSession = createClientSession();
    expect((await createSession.auth.signInWithPassword(TEST_USER)).error).toBeNull();
    expect((await reorderSession.auth.signInWithPassword(TEST_USER)).error).toBeNull();

    const first = await createSession.rpc('mutate_structured_question', {
      p_command: 'create', p_keyword_id: keywordId, p_content: content('既存1'),
    });
    const second = await createSession.rpc('mutate_structured_question', {
      p_command: 'create', p_keyword_id: keywordId, p_content: content('既存2'),
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const q1 = (first.data as { question: QuestionRow }).question;
    const q2 = (second.data as { question: QuestionRow }).question;

    execSql(`
      create function public.test_pause_question_create() returns trigger
      language plpgsql set search_path = '' as $$
      begin
        if new.question_text = '並行作成とは何か' then perform pg_catalog.pg_sleep(2); end if;
        return new;
      end $$;
      create trigger test_pause_question_create
      before insert on public.structured_questions
      for each row execute function public.test_pause_question_create();
    `);
    try {
      const creating = Promise.resolve(createSession.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: keywordId, p_content: content('並行作成'),
      }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      const reordering = reorderSession.rpc('reorder_structured_questions', {
        p_keyword_id: keywordId,
        p_ordered: [{ id: q2.id, version: q2.version }, { id: q1.id, version: q1.version }],
      });
      const [created, reordered] = await Promise.all([creating, reordering]);
      expect(created.error).toBeNull();
      expect(reordered.error).not.toBeNull();
      expect(reordered.error?.message).toContain('must match the keyword question set');
    } finally {
      execSql(`
        drop trigger test_pause_question_create on public.structured_questions;
        drop function public.test_pause_question_create();
      `);
    }

    const rows = await adminClient().from('structured_questions')
      .select('id,version,sort_order').eq('keyword_id', keywordId).order('id');
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(3);
    expect(rows.data?.find(({ id }) => id === q1.id)?.version).toBe(q1.version);
    expect(rows.data?.find(({ id }) => id === q2.id)?.version).toBe(q2.version);
  });

  test('reorders the complete active/inactive set and keeps every row unchanged on invalid or stale input', async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '並べ替え');
    const first = await seedMaterialWithKeyword(ownerId, subjectId, 'kr0001');
    const second = await seedMaterialWithKeyword(ownerId, subjectId, 'kr0002');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await client.auth.signInWithPassword(TEST_USER)).error).toBeNull();

    const create = async (keywordId: string, label: string) => {
      const result = await client.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: keywordId, p_content: content(label),
      });
      expect(result.error).toBeNull();
      return (result.data as { question: QuestionRow }).question;
    };
    const a = await create(first.keywordId, 'A');
    const b = await create(first.keywordId, 'B');
    const c = await create(first.keywordId, 'C');
    const outside = await create(second.keywordId, '外部');
    const deactivated = await client.rpc('mutate_structured_question', {
      p_command: 'set-active', p_question_id: b.id, p_expected_version: b.version,
      p_flag_patch: { is_active: false },
    });
    expect(deactivated.error).toBeNull();
    const inactive = (deactivated.data as { question: QuestionRow }).question;

    const read = async (): Promise<QuestionRow[]> => {
      const result = await adminClient().from('structured_questions')
        .select('id,keyword_id,sort_order,version,updated_at,is_active')
        .eq('keyword_id', first.keywordId).order('sort_order').order('id');
      if (result.error) throw result.error;
      return result.data as QuestionRow[];
    };
    const baseline = await read();
    const tokens = [c, inactive, a].map(({ id, version }) => ({ id, version }));

    for (const invalid of [
      [tokens[0], tokens[0], tokens[2]],
      [tokens[0], tokens[1]],
      [tokens[0], tokens[1], { id: outside.id, version: outside.version }],
    ]) {
      const rejected = await client.rpc('reorder_structured_questions', {
        p_keyword_id: first.keywordId, p_ordered: invalid,
      });
      expect(rejected.error).not.toBeNull();
      expect(await read()).toEqual(baseline);
    }

    const stale = await client.rpc('reorder_structured_questions', {
      p_keyword_id: first.keywordId,
      p_ordered: [tokens[0], { ...tokens[1], version: tokens[1]!.version - 1 }, tokens[2]],
    });
    expect(stale.error).toBeNull();
    expect(stale.data).toMatchObject({
      kind: 'version-conflict', current: { id: inactive.id, version: inactive.version },
    });
    expect(await read()).toEqual(baseline);

    execSql(`
      create function public.test_fail_question_reorder() returns trigger
      language plpgsql set search_path = '' as $$
      begin
        if new.sort_order = 1 then raise exception 'injected reorder failure'; end if;
        return new;
      end $$;
      create trigger test_fail_question_reorder
      before update on public.structured_questions
      for each row execute function public.test_fail_question_reorder();
    `);
    try {
      const interrupted = await client.rpc('reorder_structured_questions', {
        p_keyword_id: first.keywordId, p_ordered: tokens,
      });
      expect(interrupted.error).not.toBeNull();
    } finally {
      execSql(`
        drop trigger test_fail_question_reorder on public.structured_questions;
        drop function public.test_fail_question_reorder();
      `);
    }
    expect(await read()).toEqual(baseline);

    const reordered = await client.rpc('reorder_structured_questions', {
      p_keyword_id: first.keywordId, p_ordered: tokens,
    });
    expect(reordered.error).toBeNull();
    expect(reordered.data).toMatchObject({ kind: 'saved' });
    const saved = await read();
    expect(saved.map(({ id, sort_order, is_active }) => ({ id, sort_order, is_active }))).toEqual([
      { id: c.id, sort_order: 0, is_active: true },
      { id: inactive.id, sort_order: 1, is_active: false },
      { id: a.id, sort_order: 2, is_active: true },
    ]);
    for (const row of saved) {
      const before = baseline.find(({ id }) => id === row.id)!;
      expect(row.version).toBe(before.version + 1);
      expect(new Date(row.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    }
  });
});
