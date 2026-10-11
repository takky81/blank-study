import { expect, test, type Page } from '@playwright/test';

import type { ImportOperation, QuestionExchangeImportV1 } from '../src/features/questionExchange/types';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { signIn } from './fixtures';

/**
 * 交換画面のcommit経路。app-shell登録前のため本番routeを認証済みsessionのharness
 * （e2e/harness/question-exchange.html）で描画し、本番API・ローカルSupabaseに対して検証する。
 */
test.describe.configure({ mode: 'serial' });

const content = { questionText: '取込後の問い', modelAnswer: '答え', choices: ['誤り'], explanation: '解説' };

async function seedQuestion(ownerId: string, materialId: string, keywordId: string) {
  const { data, error } = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId, question_text: '古い問い', model_answer: '答え',
    choices: [], sort_order: 0, doubt_flag: true,
  }).select('id, version').single();
  if (error) throw error;
  return data as { id: string; version: number };
}

async function questions(ownerId: string) {
  const { data, error } = await adminClient().from('structured_questions').select('*').eq('owner_id', ownerId).order('id');
  if (error) throw error;
  return data;
}

async function uploadAndPreview(page: Page, operations: ImportOperation[]) {
  const file: QuestionExchangeImportV1 = {
    schemaVersion: 1, exchangeId: 'e8000000-0000-4000-8000-0000000000ff', exportedAt: '2026-10-11T00:00:00Z', operations,
  };
  await page.getByLabel('返却ファイル（JSON）').setInputFiles({
    name: 'return.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file), 'utf8'),
  });
  await page.getByRole('button', { name: 'previewを作成' }).click();
  return page.getByRole('region', { name: '取込preview' });
}

test.describe('QuestionExchangePage commit', () => {
  let ownerId = '';
  let materialId = '';
  let keywordId = '';

  test.beforeEach(async ({ page }) => {
    ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '交換commit');
    ({ materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xc0001'));
    await signIn(page);
    await page.goto('/e2e/harness/question-exchange.html');
    await expect(page.getByRole('heading', { name: '設問交換', level: 1 })).toBeVisible();
  });

  test.afterEach(async () => {
    await resetData(ownerId);
  });

  test('preview後に別経路で更新された設問はcommitで拒否され、previewを保持し何も上書きしない', async ({ page }) => {
    const q = await seedQuestion(ownerId, materialId, keywordId);
    const region = await uploadAndPreview(page, [
      { kind: 'create', keywordId, question: content },
      { kind: 'update', keywordId, questionId: q.id, expectedVersion: q.version, question: content, sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt'] },
    ]);
    await expect(region.getByText('更新 1件')).toBeVisible();

    const edited = await adminClient().from('structured_questions')
      .update({ question_text: '別経路の編集', version: q.version + 1 }).eq('id', q.id).select('*').single();
    expect(edited.error).toBeNull();
    const before = await questions(ownerId);

    await region.getByRole('button', { name: '取込を確定' }).click();
    await expect(region.getByRole('alert')).toContainText('previewの後に設問が更新されています');
    await expect(region.getByRole('alert')).toContainText('previewは保持しています');
    await expect(region.getByText('更新 1件')).toBeVisible();
    expect(await questions(ownerId)).toEqual(before);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ question_text: '別経路の編集', doubt_flag: true });
  });

  test('成功時だけ件数summaryを表示し、previewを破棄して再読込すると最新版を読む', async ({ page }) => {
    const q = await seedQuestion(ownerId, materialId, keywordId);
    const operations: ImportOperation[] = [
      { kind: 'create', keywordId, question: content },
      { kind: 'update', keywordId, questionId: q.id, expectedVersion: q.version, question: content, sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt'] },
    ];
    const region = await uploadAndPreview(page, operations);
    await region.getByRole('button', { name: '取込を確定' }).click();
    await expect(page.getByRole('status')).toContainText('追加 1件、更新 1件、疑義解除 1件、解説依頼解除 0件');
    await expect(page.getByRole('status')).toContainText('最新の状態を再読込');
    await expect(region).toBeHidden();

    const rows = await questions(ownerId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === q.id)).toMatchObject({ question_text: '取込後の問い', version: q.version + 1, doubt_flag: false });

    const reloaded = await uploadAndPreview(page, operations);
    // 再読込したsnapshotでは疑義flagが解除済みのため、同じfileは再確定できない。
    await expect(reloaded.getByText(/フラグ doubt は現在立っていないため解除できません/)).toBeVisible();
    await expect(reloaded.getByRole('button', { name: '取込を確定' })).toBeDisabled();
  });
});
