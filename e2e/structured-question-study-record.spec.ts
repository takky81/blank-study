import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

test.describe.configure({ mode: 'serial' });

test('回答記録RPCは1回答分のlogとstatsだけを確定し、版不一致は何も書かない', async () => {
  const ownerId = await ensureTestUser();
  await resetData(ownerId);
  const subjectId = await seedSubject(ownerId, '基本情報');
  const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId);
  const question = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId,
    question_text: '記録', model_answer: '答え', sort_order: 0,
  }).select('id, version').single();
  expect(question.error).toBeNull();

  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  expect((await user.auth.signInWithPassword(TEST_USER)).error).toBeNull();
  const args = {
    p_question_id: question.data!.id, p_answer: '答え', p_mode: 'written',
    p_answered_at: new Date().toISOString(),
  };

  const conflict = await user.rpc('record_structured_question_answer',
    { ...args, p_expected_question_version: question.data!.version + 1 });
  expect(conflict.error).toBeNull();
  expect(conflict.data).toEqual({ kind: 'question-conflict' });

  const recorded = await user.rpc('record_structured_question_answer',
    { ...args, p_expected_question_version: question.data!.version });
  expect(recorded.error).toBeNull();
  expect(recorded.data.kind).toBe('recorded');

  const logs = await user.from('structured_question_answer_logs').select('id, is_correct');
  expect(logs.data).toEqual([{ id: recorded.data.logId, is_correct: true }]);
  const stats = await user.from('structured_question_stats')
    .select('asked_count, correct_count, consecutive_correct, interval_days, ease_factor, due_at');
  expect(stats.data).toHaveLength(1);
  expect(stats.data![0]).toMatchObject({ asked_count: 1, correct_count: 1, consecutive_correct: 1, interval_days: 1 });
  expect(Number(stats.data![0].ease_factor)).toBeCloseTo(2.6);
  expect(recorded.data.stats).toMatchObject(stats.data![0]);
});
