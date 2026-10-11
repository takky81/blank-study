import { expect, test, type Page } from '@playwright/test';

async function openActions(page: Page, questionText: string) {
  const button = page.getByRole('button', { name: `「${questionText}」のその他の操作` });
  if (await button.count() > 0 && await button.getAttribute('aria-expanded') !== 'true') await button.click();
}

async function createQuestion(page: Page, questionText: string, answer: string) {
  await page.getByRole('button', { name: /最初の設問を作成|設問を作成/ }).click();
  await page.getByLabel('設問文').fill(questionText);
  await page.getByLabel('模範解答').fill(answer);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: questionText })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/harness/question-bank.html?reset=1');
  await expect(page.getByText('認証済み')).toBeVisible();
  await expect(page.getByText('認証必須route')).toBeVisible();
  await expect(page.getByText('このキーワードには設問がまだありません。')).toBeVisible();
});

test('descriptor由来の認証ゲートは未認証時にroute adapterを描画しない', async ({ page }) => {
  await page.getByRole('button', { name: '未認証にする' }).click();
  await expect(page.getByRole('alert')).toContainText('認証が必要です');
  await expect(page.getByRole('heading', { name: '設問バンク' })).toHaveCount(0);
  await page.getByRole('button', { name: '認証済みにする' }).click();
  await expect(page.getByRole('heading', { name: '設問バンク' })).toBeVisible();
});

test('作成、再読込、編集、順序、状態、flag、削除の確認と取消をroute上で継続できる', async ({ page }) => {
  await createQuestion(page, '最初の設問', '最初の答え');
  await page.reload();
  await expect(page.getByRole('heading', { name: '最初の設問' })).toBeVisible();

  await openActions(page, '最初の設問');
  await page.getByRole('button', { name: '設問を編集' }).click();
  await page.getByLabel('設問文').fill('編集済みの設問');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '編集済みの設問' })).toBeVisible();

  await createQuestion(page, '二番目の設問', '二番目の答え');
  await openActions(page, '二番目の設問');
  const secondRow = page.getByRole('heading', { name: '二番目の設問' }).locator('xpath=ancestor::li');
  await secondRow.getByRole('button', { name: '上へ移動' }).click();
  await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('二番目の設問');
  await page.getByRole('button', { name: '設問バンクを再表示' }).click();
  await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('二番目の設問');

  await openActions(page, '二番目の設問');
  await secondRow.getByRole('button', { name: '設問を無効にする' }).click();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openActions(page, '二番目の設問');
  await secondRow.getByRole('button', { name: '設問を無効にする' }).click();
  await page.getByRole('button', { name: '無効にする', exact: true }).click();
  await expect(page.getByText('状態: 無効')).toBeVisible();
  await openActions(page, '二番目の設問');
  await secondRow.getByRole('button', { name: '設問を有効にする' }).click();
  await page.getByRole('button', { name: '有効にする', exact: true }).click();
  await expect(page.getByText('状態: 有効').first()).toBeVisible();

  await openActions(page, '二番目の設問');
  await secondRow.getByRole('button', { name: '疑義フラグを解除' }).click();
  await openActions(page, '二番目の設問');
  await secondRow.getByRole('button', { name: '解説追加フラグを解除' }).click();
  const second = page.getByRole('heading', { name: '二番目の設問' }).locator('xpath=ancestor::li');
  await expect(second).toContainText('疑義フラグ: なし');
  await expect(second).toContainText('解説追加フラグ: なし');

  const firstRow = page.getByRole('heading', { name: '編集済みの設問' }).locator('xpath=ancestor::li');
  await openActions(page, '編集済みの設問');
  await firstRow.getByRole('button', { name: '設問を削除' }).click();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByRole('heading', { name: '編集済みの設問' })).toBeVisible();
  await openActions(page, '編集済みの設問');
  await firstRow.getByRole('button', { name: '設問を削除' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('heading', { name: '編集済みの設問' })).toHaveCount(0);
});

test('読込errorからretryしてemptyへ戻る', async ({ page }) => {
  await page.getByRole('button', { name: '次の読込を失敗させる' }).click();
  await page.getByRole('button', { name: '設問バンクを再表示' }).click();
  await expect(page.getByRole('alert')).toContainText('テスト用の読込失敗');
  await page.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByText('このキーワードには設問がまだありません。')).toBeVisible();
});

test('stale保存は現在内容を変えず、現在版の再読込後も操作を継続できる', async ({ page }) => {
  await createQuestion(page, 'サーバー上の設問', '答え');
  await openActions(page, 'サーバー上の設問');
  await page.getByRole('button', { name: '設問を編集' }).click();
  await page.getByLabel('設問文').fill('staleな編集内容');
  await page.getByRole('button', { name: '次の保存を競合させる' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '編集内容を保持しています' })).toBeVisible();
  await expect(page.getByLabel('設問文')).toHaveValue('staleな編集内容');
  await page.getByRole('button', { name: /現在の版 .* を再読込して確認/ }).click();
  await page.getByRole('button', { name: '現在の版を再読込' }).click();
  await expect(page.getByRole('heading', { name: 'サーバー側で更新された設問' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'staleな編集内容' })).toHaveCount(0);

  await openActions(page, 'サーバー側で更新された設問');
  await page.getByRole('button', { name: '設問を編集' }).click();
  await page.getByLabel('設問文').fill('競合解消後の設問');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '競合解消後の設問' })).toBeVisible();
});
