import { expect, test, type Page } from '@playwright/test';

import type { ImportOperation, QuestionExchangeImportV1 } from '../src/features/questionExchange/types';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { TEST_USER } from './env';

type PreviewModule = typeof import('./harness/question-exchange-preview');

test.describe.configure({ mode: 'serial' });

const OTHER_USER = { email: 'e2e-exchange-preview-other@example.test', password: 'e2epassword' };
const UNKNOWN_KEYWORD = 'e6000000-0000-4000-8000-000000000001';
const UNKNOWN_QUESTION = 'e6000000-0000-4000-8000-000000000002';
const content = { questionText: '新しい問い', modelAnswer: '答え', choices: ['誤り'], explanation: '解説' };

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

async function seedQuestion(ownerId: string, materialId: string, keywordId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId, question_text: '古い問い', model_answer: '答え',
    choices: [], sort_order: 0, ...overrides,
  }).select('id, version').single();
  if (error) throw error;
  return data as { id: string; version: number };
}

/** 両ownerのquestions（内容・version・flag）とkeywordsの全列snapshot。 */
async function dbSnapshot(ownerIds: string[]) {
  const db = adminClient();
  const questions = await db.from('structured_questions').select('*').in('owner_id', ownerIds).order('id');
  const keywords = await db.from('keywords').select('*').in('owner_id', ownerIds).order('id');
  if (questions.error) throw questions.error;
  if (keywords.error) throw keywords.error;
  return { questions: questions.data, keywords: keywords.data };
}

async function signInPage(page: Page) {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(TEST_USER.email);
  await page.getByLabel('パスワード').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();
}

function preview(page: Page, operations: ImportOperation[]) {
  const file: QuestionExchangeImportV1 = {
    schemaVersion: 1, exchangeId: 'e6000000-0000-4000-8000-0000000000ff', exportedAt: '2026-10-11T00:00:00Z', operations,
  };
  return page.evaluate(async (json) => {
    const modulePath = '/e2e/harness/question-exchange-preview.ts';
    const mod = await import(/* @vite-ignore */ modulePath) as PreviewModule;
    return mod.runQuestionExchangePreview(json);
  }, JSON.stringify(file));
}

test.describe('ImportPreviewReadPath', () => {
  let ownerId = '';
  let otherId = '';

  test.beforeEach(async () => {
    ownerId = await ensureTestUser();
    otherId = await ensureUser(OTHER_USER);
    await resetData(ownerId);
    await resetData(otherId);
  });

  test.afterEach(async () => {
    await resetData(ownerId);
    await resetData(otherId);
  });

  test('実read pathでcreate/update/stale競合を分類し、preview前後でDBを変更しない', async ({ page }) => {
    const subjectId = await seedSubject(ownerId, '交換preview');
    const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xp0001');
    const fresh = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true });
    const stale = await seedQuestion(ownerId, materialId, keywordId, { sort_order: 1 });
    const update = (questionId: string, expectedVersion: number): ImportOperation => ({
      kind: 'update', keywordId, questionId, expectedVersion, question: content,
      sourceRequestedFlags: questionId === fresh.id ? ['doubt'] : [],
      resolvedFlags: questionId === fresh.id ? ['doubt'] : [],
    });

    await signInPage(page);
    const before = await dbSnapshot([ownerId, otherId]);
    const okPreview = await preview(page, [{ kind: 'create', keywordId, question: content }, update(fresh.id, fresh.version)]);
    const stalePreview = await preview(page, [update(stale.id, stale.version + 1)]);
    const after = await dbSnapshot([ownerId, otherId]);

    expect(okPreview.canCommit).toBe(true);
    expect(okPreview.items.map((i) => i.kind)).toEqual(['create', 'update']);
    const updated = okPreview.items[1];
    if (updated?.kind !== 'update') throw new Error('updateではありません');
    expect(updated.before).toMatchObject({ id: fresh.id, version: fresh.version, questionText: '古い問い', doubtFlag: true });
    expect(updated.after).toEqual(content);

    expect(stalePreview.canCommit).toBe(false);
    expect(stalePreview.items).toHaveLength(1);
    const conflict = stalePreview.items[0];
    if (conflict?.kind !== 'conflict') throw new Error('conflictではありません');
    expect(conflict.current).toMatchObject({ id: stale.id, version: stale.version, questionText: '古い問い' });
    expect(conflict.incoming).toEqual(update(stale.id, stale.version + 1));

    expect(after.questions.length).toBe(2);
    expect(after).toEqual(before);
  });

  test('他ownerのkeyword/questionは未知IDと同じerror表現になり、DBを変更しない', async ({ page }) => {
    const subjectId = await seedSubject(ownerId, '交換preview');
    await seedMaterialWithKeyword(ownerId, subjectId, 'xp0002');
    const otherSubject = await seedSubject(otherId, '他人');
    const other = await seedMaterialWithKeyword(otherId, otherSubject, 'xp0003');
    const foreign = await seedQuestion(otherId, other.materialId, other.keywordId);

    const ops = (keywordId: string, questionId: string): ImportOperation[] => [
      { kind: 'create', keywordId, question: content },
      { kind: 'update', keywordId, questionId, expectedVersion: 1, question: content, sourceRequestedFlags: [], resolvedFlags: [] },
    ];
    const normalize = (text: string, keywordId: string, questionId: string) =>
      text.replaceAll(keywordId, 'KEYWORD').replaceAll(questionId, 'QUESTION');

    await signInPage(page);
    const before = await dbSnapshot([ownerId, otherId]);
    const foreignPreview = await preview(page, ops(other.keywordId, foreign.id));
    const unknownPreview = await preview(page, ops(UNKNOWN_KEYWORD, UNKNOWN_QUESTION));
    const after = await dbSnapshot([ownerId, otherId]);

    expect(foreignPreview.canCommit).toBe(false);
    expect(foreignPreview.items.length).toBeGreaterThan(0);
    expect(foreignPreview.items.every((i) => i.kind === 'error')).toBe(true);
    expect(normalize(JSON.stringify(foreignPreview), other.keywordId, foreign.id))
      .toBe(normalize(JSON.stringify(unknownPreview), UNKNOWN_KEYWORD, UNKNOWN_QUESTION));
    expect(after).toEqual(before);
  });
});
