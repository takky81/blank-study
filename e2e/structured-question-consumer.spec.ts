import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { TEST_USER } from './env';

type ConsumerModule = typeof import('./harness/structured-question-consumer');

test.describe.serial('structured question public consumer contract', () => {
  test('production公開境界で教材読取と独立flag更新・解除・競合を処理する', async ({ page }) => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, 'consumer契約');
    const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'q4c201');
    const seeded = await adminClient().from('structured_questions').insert({
      owner_id: ownerId,
      material_id: materialId,
      keyword_id: keywordId,
      question_text: '設問',
      model_answer: '答え',
      choices: ['誤答'],
      explanation: '既存解説',
      sort_order: 0,
    });
    expect(seeded.error).toBeNull();

    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();

    const result = await page.evaluate(async (materialId) => {
      const modulePath = '/e2e/harness/structured-question-consumer.ts';
      const consumer = await import(/* @vite-ignore */ modulePath) as ConsumerModule;
      return consumer.exerciseQuestionConsumer(materialId);
    }, materialId);

    expect(result).toMatchObject({
      initial: { explanation: '既存解説', doubtFlag: false, explanationRequestFlag: false, version: 1 },
      bothSet: { explanation: '既存解説', doubtFlag: true, explanationRequestFlag: true, version: 3 },
      doubtCleared: { doubtFlag: false, explanationRequestFlag: true, version: 4 },
      explanationCleared: { doubtFlag: false, explanationRequestFlag: false, version: 5 },
      stale: { kind: 'version-conflict', current: { version: 5 } },
      error: '設問のフラグ更新に失敗しました',
    });
    expect(result.initial.id).toBe(result.bothSet.id);
  });

  test('consumer fixtureは公開契約以外のDB依存を持たない', () => {
    const source = readFileSync('e2e/harness/structured-question-consumer.ts', 'utf8');
    expect(source).not.toMatch(/supabase|\.from\s*\(|\.rpc\s*\(|structured_questions/);
  });
});
