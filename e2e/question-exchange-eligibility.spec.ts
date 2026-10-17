import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { EligibilityFilter, EligibilityTarget } from '../src/features/questionExchange/types';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

test.describe.configure({ mode: 'serial' });

type FixtureQuestion = {
  id: string;
  keywordId: string;
  isActive: boolean;
  doubtFlag: boolean;
  explanationRequestFlag: boolean;
};
type FixtureCase = {
  name: string;
  filter: EligibilityFilter;
  questions: FixtureQuestion[];
  stats: { questionId: string; askedCount: number; correctCount: number }[];
  expected: EligibilityTarget[];
};

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'src/features/questionExchange/fixtures/eligibility-cases.json'), 'utf8'),
) as { cases: FixtureCase[] };

const OTHER_USER = { email: 'e2e-exchange-other@example.test', password: 'e2epassword' };

async function signIn(credentials: { email: string; password: string }): Promise<SupabaseClient> {
  const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  expect((await user.auth.signInWithPassword(credentials)).error).toBeNull();
  return user;
}

async function ensureUser(credentials: { email: string; password: string }): Promise<string> {
  const db = adminClient();
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw error;
  const existing = data.users.find((u) => u.email === credentials.email);
  if (existing) return existing.id;
  const created = await db.auth.admin.createUser({ ...credentials, email_confirm: true });
  if (created.error) throw created.error;
  return created.data.user.id;
}

function rpcArgs(filter: EligibilityFilter) {
  return {
    p_minimum_attempts: filter.minimumAttempts,
    p_maximum_accuracy: filter.maximumAccuracy,
    p_maximum_question_count: filter.maximumQuestionCount,
    ...(filter.requireWrong === undefined ? {} : { p_require_wrong: filter.requireWrong }),
  };
}

/** fixtureの論理IDを文字列順を保つUUIDへ対応付け、DBとpure ruleの安定順を揃える。 */
function orderedUuidMap(logicalIds: readonly string[]): Map<string, string> {
  const logical = [...new Set(logicalIds)].sort();
  const uuids = logical.map(() => randomUUID()).sort();
  return new Map(logical.map((id, i) => [id, uuids[i]!]));
}

async function seedCase(ownerId: string, testCase: FixtureCase) {
  const db = adminClient();
  const subjectId = await seedSubject(ownerId, '交換fixture');
  const { materialId, chapterId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xf0000');
  const keywordMap = orderedUuidMap(testCase.questions.map((q) => q.keywordId));
  const questionMap = orderedUuidMap(testCase.questions.map((q) => q.id));

  const keywords = [...keywordMap.entries()].map(([logical, id], i) => ({
    id, material_id: materialId, chapter_id: chapterId, owner_id: ownerId,
    doc_id: `xf${String(i + 1).padStart(4, '0')}`, answers: [logical], tags: ['用語'],
  }));
  if (keywords.length > 0) expect((await db.from('keywords').insert(keywords)).error).toBeNull();

  const questions = testCase.questions.map((q, i) => ({
    id: questionMap.get(q.id), keyword_id: keywordMap.get(q.keywordId), material_id: materialId,
    owner_id: ownerId, question_text: `設問${q.id}`, model_answer: '答え', sort_order: i,
    is_active: q.isActive, doubt_flag: q.doubtFlag, explanation_request_flag: q.explanationRequestFlag,
  }));
  if (questions.length > 0) expect((await db.from('structured_questions').insert(questions)).error).toBeNull();

  const stats = testCase.stats.map((s) => ({
    question_id: questionMap.get(s.questionId), owner_id: ownerId,
    asked_count: s.askedCount, correct_count: s.correctCount,
  }));
  if (stats.length > 0) expect((await db.from('structured_question_stats').insert(stats)).error).toBeNull();
  return { keywordMap, questionMap };
}

function toUuidTargets(
  expected: EligibilityTarget[],
  keywordMap: Map<string, string>,
  questionMap: Map<string, string>,
) {
  return expected.map((target) => ({
    ...target,
    keywordId: keywordMap.get(target.keywordId),
    flaggedQuestions: target.flaggedQuestions.map((q) => ({ ...q, questionId: questionMap.get(q.questionId) })),
  }));
}

for (const testCase of fixture.cases) {
  test(`DB eligibility RPCは共有fixtureでpure ruleと一致する: ${testCase.name}`, async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const { keywordMap, questionMap } = await seedCase(ownerId, testCase);

    const user = await signIn(TEST_USER);
    const result = await user.rpc('get_question_exchange_candidates', rpcArgs(testCase.filter));
    expect(result.error).toBeNull();
    expect(result.data).toEqual(toUuidTargets(testCase.expected, keywordMap, questionMap));
  });
}

test('他ownerの設問・統計と穴埋め履歴は評価されず、自分の対象だけを返す', async () => {
  const ownerId = await ensureTestUser();
  const otherId = await ensureUser(OTHER_USER);
  await resetData(ownerId);
  await resetData(otherId);
  const db = adminClient();

  const mine = await seedMaterialWithKeyword(ownerId, await seedSubject(ownerId, '自分'), 'xo0001');
  const theirs = await seedMaterialWithKeyword(otherId, await seedSubject(otherId, '他人'), 'xo0002');
  const inserted = await db.from('structured_questions').insert([
    { owner_id: ownerId, material_id: mine.materialId, keyword_id: mine.keywordId, question_text: '自分', model_answer: '答え', doubt_flag: false },
    {
      owner_id: otherId, material_id: theirs.materialId, keyword_id: theirs.keywordId,
      question_text: '他人', model_answer: '答え', doubt_flag: true,
    },
  ]);
  expect(inserted.error).toBeNull();
  // 穴埋め統計は誤答が多くても設問交換の統計へ合算されない
  expect((await db.from('keyword_stats').upsert({
    keyword_id: mine.keywordId, owner_id: ownerId, total_count: 50, correct_count: 10,
  })).error).toBeNull();

  const filter = { minimumAttempts: 0, maximumAccuracy: 1, maximumQuestionCount: 10 };
  const user = await signIn(TEST_USER);
  const result = await user.rpc('get_question_exchange_candidates', rpcArgs(filter));
  expect(result.error).toBeNull();
  expect(result.data).toEqual([]);

  const other = await signIn(OTHER_USER);
  const otherResult = await other.rpc('get_question_exchange_candidates', rpcArgs(filter));
  expect(otherResult.error).toBeNull();
  expect((otherResult.data as EligibilityTarget[]).map((t) => t.keywordId)).toEqual([theirs.keywordId]);
  await resetData(otherId);
});

test('不正な閾値はRPCで拒否され、匿名利用者は呼び出せない', async () => {
  await ensureTestUser();
  const user = await signIn(TEST_USER);
  for (const filter of [
    { minimumAttempts: -1, maximumAccuracy: 0.5, maximumQuestionCount: 1 },
    { minimumAttempts: 1.5, maximumAccuracy: 0.5, maximumQuestionCount: 1 },
    { minimumAttempts: 1, maximumAccuracy: 1.01, maximumQuestionCount: 1 },
    { minimumAttempts: 1, maximumAccuracy: 0.5, maximumQuestionCount: -1 },
  ]) {
    const result = await user.rpc('get_question_exchange_candidates', rpcArgs(filter));
    expect(result.error?.code).toBe('22023');
  }
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const anonResult = await anon.rpc(
    'get_question_exchange_candidates',
    rpcArgs({ minimumAttempts: 0, maximumAccuracy: 1, maximumQuestionCount: 1 }),
  );
  expect(anonResult.error).not.toBeNull();
  expect(anonResult.data).toBeNull();
});

test('1,000件を超えるkeywordと設問でも対象を欠落・重複なく1回で返す', async () => {
  test.setTimeout(120_000);
  const ownerId = await ensureTestUser();
  await resetData(ownerId);
  const db = adminClient();
  const { materialId, chapterId } = await seedMaterialWithKeyword(ownerId, await seedSubject(ownerId, '大量'), 'xv0000');

  const count = 1_205;
  const keywordIds = Array.from({ length: count }, () => randomUUID()).sort();
  const keywords = keywordIds.map((id, i) => ({
    id, material_id: materialId, chapter_id: chapterId, owner_id: ownerId,
    doc_id: `xv${String(i + 1).padStart(4, '0')}`, answers: [`語${i}`], tags: ['用語'],
  }));
  const questions = keywordIds.map((keywordId, i) => ({
    id: randomUUID(), keyword_id: keywordId, material_id: materialId, owner_id: ownerId,
    question_text: `設問${i}`, model_answer: '答え', doubt_flag: i % 3 === 0,
  }));
  // フラグなし設問はすべて出題2回・誤答1回以上の統計を持ち、統計branchで対象になる
  const stats = questions.filter((_, i) => i % 3 !== 0).map((q, i) => ({
    question_id: q.id, owner_id: ownerId, asked_count: 2, correct_count: i % 2,
  }));
  for (let i = 0; i < count; i += 500) {
    expect((await db.from('keywords').insert(keywords.slice(i, i + 500))).error).toBeNull();
    expect((await db.from('structured_questions').insert(questions.slice(i, i + 500))).error).toBeNull();
  }
  for (let i = 0; i < stats.length; i += 500) {
    expect((await db.from('structured_question_stats').insert(stats.slice(i, i + 500))).error).toBeNull();
  }

  const user = await signIn(TEST_USER);
  const result = await user.rpc('get_question_exchange_candidates', rpcArgs({
    minimumAttempts: 1, maximumAccuracy: 1, maximumQuestionCount: 1,
  }));
  expect(result.error).toBeNull();
  const targets = result.data as EligibilityTarget[];
  expect(targets).toHaveLength(count);
  expect(targets.map((t) => t.keywordId)).toEqual(keywordIds);
  expect(targets.filter((t) => t.reasons.includes('doubt-flag'))).toHaveLength(Math.ceil(count / 3));
  await resetData(ownerId);
});
