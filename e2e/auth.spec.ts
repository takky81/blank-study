import { test, expect } from '@playwright/test';
import { TEST_USER } from './env';
import { ensureTestUser } from './db';

/** 決定表「認証」 spec/tables/01-auth.jsonl */
test.describe('認証', () => {
  test.beforeAll(async () => {
    await ensureTestUser();
  });

  test('列1 ログインできる', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();
  });

  test('列2 パスワードが違うとログインできない', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill('wrong-password');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('alert')).toHaveText('メールアドレスまたはパスワードが違います');
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('列3 未登録メールでログインできない（列2と同じ文言）', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('メールアドレス').fill('nobody@example.test');
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('alert')).toHaveText('メールアドレスまたはパスワードが違います');
  });

  test('列4 未ログインならログイン画面に戻される', async ({ page }) => {
    await page.goto('/subjects/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('列5 ログアウトできる', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('列7 メールの形式が不正なら入力エラーを出し、認証を要求しない', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('メールアドレス').fill('not-an-email');
    await page.getByLabel('パスワード').fill(TEST_USER.password);

    let requested = false;
    await page.route('**/auth/v1/token**', async (route) => {
      requested = true;
      await route.continue();
    });

    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('alert')).toHaveText('メールアドレスの形式が正しくありません');
    expect(requested).toBe(false);
  });

  test('列8 メールかパスワードが空ならログインを受け付けない', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeDisabled();

    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeDisabled();

    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeEnabled();
  });
});
