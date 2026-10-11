import { execFileSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { updateSrs, type SrsState } from '../src/features/study/srs';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

type StatsRow = {
  asked_count: number;
  correct_count: number;
  consecutive_correct: number;
  interval_days: number;
  ease_factor: number | string;
  due_at: string;
  updated_at: string;
};

const DAY_MS = 86_400_000;

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql],
    { encoding: 'utf8' },
  );
}

/** 対象設問に限定して失敗する一時triggerを作り、finallyで必ず消す。 */
async function withFaultTrigger<T>(input: {
  name: string;
  table: 'structured_question_answer_logs' | 'structured_question_stats';
  timing: string;
  questionId: string;
}, run: () => Promise<T>): Promise<T> {
  const fn = `public.${input.name}_fn`;
  psql([
    `create or replace function ${fn}() returns trigger language plpgsql as $f$ begin ` +
      `if new.question_id = '${input.questionId}'::uuid then ` +
      `raise exception 'injected fault ${input.name}'; end if; return new; end $f$`,
    `create trigger ${input.name} ${input.timing} on public.${input.table} ` +
      `for each row execute function ${fn}()`,
  ].join('; '));
  try {
    return await run();
  } finally {
    psql(`drop trigger if exists ${input.name} on public.${input.table}; drop function if exists ${fn}()`);
  }
}

async function signIn(): Promise<SupabaseClient> {
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  expect((await user.auth.signInWithPassword(TEST_USER)).error).toBeNull();
  return user;
}

async function snapshot(ownerId: string, questionId: string) {
  const db = adminClient();
  const [logs, stats, keywordLogs, keywordStats] = await Promise.all([
    db.from('structured_question_answer_logs').select('*').eq('question_id', questionId).order('answered_at'),
    db.from('structured_question_stats').select('*').eq('question_id', questionId),
    db.from('answer_logs').select('*').eq('owner_id', ownerId).order('id'),
    db.from('keyword_stats').select('*').eq('owner_id', ownerId).order('keyword_id'),
  ]);
  for (const r of [logs, stats, keywordLogs, keywordStats]) expect(r.error).toBeNull();
  return { logs: logs.data!, stats: stats.data!, keywordLogs: keywordLogs.data!, keywordStats: keywordStats.data! };
}

function expectSrs(row: StatsRow, previous: SrsState | null, correct: boolean): SrsState {
  const now = new Date(row.updated_at);
  const expected = updateSrs(previous, { correct, now });
  expect(row.consecutive_correct).toBe(expected.repetition);
  expect(row.interval_days).toBe(expected.interval);
  expect(Number(row.ease_factor)).toBeCloseTo(expected.easeFactor, 10);
  expect(new Date(row.due_at).getTime() - now.getTime()).toBe(expected.interval * DAY_MS);
  return { repetition: expected.repetition, interval: expected.interval, easeFactor: expected.easeFactor };
}

test.describe.serial('QuestionStudyDatabaseConformance', () => {
  let ownerId: string;
  let questionId: string;
  let version: number;
  let user: SupabaseClient;

  test.beforeEach(async () => {
    ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '原子性');
    const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'qsd001');
    const ks = await adminClient().from('keyword_stats').upsert({
      keyword_id: keywordId, owner_id: ownerId, total_count: 1, correct_count: 1,
      repetition: 1, ease_factor: 2.6, interval_days: 1,
    });
    expect(ks.error).toBeNull();
    const q = await adminClient().from('structured_questions').insert({
      owner_id: ownerId, material_id: materialId, keyword_id: keywordId,
      question_text: '原子性を問う', model_answer: '答え', sort_order: 0,
    }).select('id, version').single();
    expect(q.error).toBeNull();
    questionId = q.data!.id as string;
    version = q.data!.version as number;
    user = await signIn();
  });

  const answer = (text: string, expectedVersion = version) => user.rpc('record_structured_question_answer', {
    p_question_id: questionId, p_expected_question_version: expectedVersion,
    p_answer: text, p_mode: 'written', p_answered_at: new Date().toISOString(),
  });

  test('正解・不正解・正解の連続回答で履歴とstatsとSRSが最新stateから積み上がり、穴埋め側は不変', async () => {
    const before = await snapshot(ownerId, questionId);
    expect(before.keywordLogs.length).toBeGreaterThan(0);
    expect(before.keywordStats.length).toBeGreaterThan(0);

    let srs: SrsState | null = null;
    const sequence: { text: string; correct: boolean }[] = [
      { text: '答え', correct: true },
      { text: '誤答', correct: false },
      { text: ' 答え ', correct: true },
      { text: '答え', correct: true },
    ];
    for (const [i, step] of sequence.entries()) {
      const res = await answer(step.text);
      expect(res.error).toBeNull();
      expect(res.data.kind).toBe('recorded');
      const snap = await snapshot(ownerId, questionId);
      expect(snap.logs).toHaveLength(i + 1);
      expect(snap.logs[i]).toMatchObject({ id: res.data.logId, is_correct: step.correct, answer: step.text });
      expect(snap.stats).toHaveLength(1);
      const row = snap.stats[0] as StatsRow;
      expect(row.asked_count).toBe(i + 1);
      expect(row.correct_count).toBe(sequence.slice(0, i + 1).filter((s) => s.correct).length);
      srs = expectSrs(row, srs, step.correct);
      expect(snap.keywordLogs).toEqual(before.keywordLogs);
      expect(snap.keywordStats).toEqual(before.keywordStats);
    }
  });

  test('古い版の回答はconflictを返し、履歴もstatsも書かない', async () => {
    expect((await answer('答え')).data.kind).toBe('recorded');
    const before = await snapshot(ownerId, questionId);
    const bump = await adminClient().from('structured_questions')
      .update({ question_text: '改訂後' }).eq('id', questionId).select('version').single();
    expect(bump.error).toBeNull();
    expect(bump.data!.version).toBeGreaterThan(version);

    const stale = await answer('答え', version);
    expect(stale.error).toBeNull();
    expect(stale.data).toEqual({ kind: 'question-conflict' });
    expect(await snapshot(ownerId, questionId)).toEqual(before);
  });

  test('履歴追加後に失敗を注入すると、履歴もstatsも部分成功を残さない', async () => {
    expect((await answer('答え')).data.kind).toBe('recorded');
    const before = await snapshot(ownerId, questionId);
    const res = await withFaultTrigger({
      name: 'sq_fault_after_log', table: 'structured_question_answer_logs',
      timing: 'after insert', questionId,
    }, async () => await answer('答え'));
    expect(res.error?.message).toContain('injected fault');
    expect(await snapshot(ownerId, questionId)).toEqual(before);
  });

  test('stats更新中に失敗を注入すると、追加済みの履歴も巻き戻る', async () => {
    for (const timing of ['before insert', 'before update']) {
      if (timing === 'before update') expect((await answer('答え')).data.kind).toBe('recorded');
      const before = await snapshot(ownerId, questionId);
      const res = await withFaultTrigger({
        name: 'sq_fault_stats', table: 'structured_question_stats', timing, questionId,
      }, async () => await answer('誤答'));
      expect(res.error?.message).toContain('injected fault');
      expect(await snapshot(ownerId, questionId)).toEqual(before);
    }
  });
});
