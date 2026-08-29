import { test as base, expect, type Page } from '@playwright/test';
import { ensureTestUser, resetData } from './db';
import { TEST_USER } from './env';

/** ログイン画面から入る。決定表「認証」列1 の経路。 */
export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(TEST_USER.email);
  await page.getByLabel('パスワード').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();
}

/** 各テストを空のデータから始める。 */
export const test = base.extend<{ signedIn: Page }>({
  signedIn: async ({ page }, use) => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    await signIn(page);
    await use(page);
  },
});

export { expect };
export type { Page };
