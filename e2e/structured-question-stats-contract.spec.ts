import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { aggregateKeywordQuestionStudy } from '../src/features/questionStudy/statsContract';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

test.describe.configure({ mode: 'serial' });

async function insertQuestion(ownerId: string, materialId: string, keywordId: string, sortOrder: number) {
  const inserted = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId,
    question_text: `設問${sortOrder}`, model_answer: '答え', sort_order: sortOrder,
  }).select('id').single();
  expect(inserted.error).toBeNull();
  return inserted.data!.id as string;
}

async function answer(user: SupabaseClient, questionId: string, text: string) {
  const current = await user.from('structured_questions').select('version').eq('id', questionId).single();
  expect(current.error).toBeNull();
  const recorded = await user.rpc('record_structured_question_answer', {
    p_question_id: questionId, p_answer: text, p_mode: 'written',
    p_answered_at: new Date().toISOString(), p_expected_question_version: current.data!.version,
  });
  expect(recorded.error).toBeNull();
  expect(recorded.data.kind).toBe('recorded');
}

/** 下流consumerと同じ手順: 認証ユーザーとしてSELECTだけで有効設問とstatsを読み、純粋集計へ渡す。 */
async function consumerAggregates(user: SupabaseClient) {
  const questions = await user.from('structured_questions')
    .select('id, keyword_id, is_active').eq('is_active', true).order('id');
  expect(questions.error).toBeNull();
  const ids = (questions.data ?? []).map((row) => row.id as string);
  const stats = await user.from('structured_question_stats')
    .select('question_id, asked_count, correct_count').in('question_id', ids).order('question_id');
  expect(stats.error).toBeNull();
  return aggregateKeywordQuestionStudy(
    (questions.data ?? []).map((row) => ({ id: row.id, keywordId: row.keyword_id, isActive: row.is_active })),
    (stats.data ?? []).map((row) => ({
      questionId: row.question_id, askedCount: row.asked_count, correctCount: row.correct_count,
    })),
  );
}

test('下流consumerは専用テーブルへ書かずに有効設問だけのkeyword統計を取得できる', async () => {
  const ownerId = await ensureTestUser();
  await resetData(ownerId);
  const subjectId = await seedSubject(ownerId, '統計契約');
  const a = await seedMaterialWithKeyword(ownerId, subjectId, 'st52aa');
  const b = await seedMaterialWithKeyword(ownerId, subjectId, 'st52bb');

  const answered = await insertQuestion(ownerId, a.materialId, a.keywordId, 0);
  await insertQuestion(ownerId, a.materialId, a.keywordId, 1); // statsなし
  const inactive = await insertQuestion(ownerId, a.materialId, a.keywordId, 2);
  const deleted = await insertQuestion(ownerId, a.materialId, a.keywordId, 3);
  await insertQuestion(ownerId, b.materialId, b.keywordId, 0); // 未出題のみ

  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  expect((await user.auth.signInWithPassword(TEST_USER)).error).toBeNull();
  await answer(user, answered, '答え');
  await answer(user, answered, 'ちがう');
  await answer(user, answered, '答え');
  await answer(user, inactive, '答え');
  await answer(user, deleted, '答え');

  const db = adminClient();
  expect((await db.from('structured_questions').update({ is_active: false }).eq('id', inactive)).error).toBeNull();
  expect((await db.from('structured_questions').delete().eq('id', deleted)).error).toBeNull();
  // 穴埋め統計は混ざらない
  expect((await db.from('keyword_stats').upsert({
    keyword_id: a.keywordId, owner_id: ownerId, total_count: 50, correct_count: 40,
  })).error).toBeNull();

  const snapshot = async () => Promise.all(
    ['structured_question_stats', 'structured_question_answer_logs', 'structured_questions', 'keyword_stats']
      .map(async (table) => (await db.from(table).select('*')).data),
  );
  const before = await snapshot();
  const aggregates = await consumerAggregates(user);
  // consumer経路は専用テーブルを含めどこにも書き込まない
  expect(await snapshot()).toEqual(before);

  const byKeyword = new Map(aggregates.map((item) => [item.keywordId, item]));
  expect(aggregates).toHaveLength(2);
  expect(byKeyword.get(a.keywordId)).toEqual({
    keywordId: a.keywordId, attempts: 3, correct: 2, wrong: 1, accuracy: 2 / 3, questionCount: 2,
  });
  expect(byKeyword.get(b.keywordId)).toEqual({
    keywordId: b.keywordId, attempts: 0, correct: 0, wrong: 0, accuracy: null, questionCount: 1,
  });
});
