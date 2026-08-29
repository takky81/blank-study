import { test, expect } from '@playwright/test';
import { TEST_USER } from './env';
import { ensureTestUser, adminClient } from './db';

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

test.describe('認証の残りの条件', () => {
  test('列6 他人のデータは1件も見えない', async ({ page }) => {
    const ownerId = await ensureTestUser();
    const db = adminClient();

    // 別の利用者を作り、その人の科目を1件用意する
    const other = await db.auth.admin.createUser({
      email: 'other@example.test',
      password: 'other-password-1234',
      email_confirm: true,
    });
    const otherId =
      other.data.user?.id ??
      (await db.auth.admin.listUsers()).data.users.find((u) => u.email === 'other@example.test')
        ?.id;
    if (!otherId) throw new Error('別の利用者を用意できませんでした');

    await db.from('subjects').delete().eq('owner_id', otherId);
    const seeded = await db
      .from('subjects')
      .insert({ name: '他人の科目', owner_id: otherId, sort_order: 0 })
      .select('id')
      .single();
    if (seeded.error) throw seeded.error;

    await db.from('subjects').delete().eq('owner_id', ownerId);

    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();

    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();
    await expect(page.getByText('他人の科目')).toHaveCount(0);

    // URL を直接開いても中身は返らない
    await page.goto(`/subjects/${seeded.data.id}`);
    await expect(page.getByText('この科目は見つかりませんでした。')).toBeVisible();

    await db.from('subjects').delete().eq('owner_id', otherId);
  });

  test('列9 通信に失敗したときは資格情報の誤りと別の文言にする', async ({ page }) => {
    await page.goto('/');
    await page.route('**/auth/v1/token**', (route) => route.abort('failed'));

    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toHaveText('メールアドレスまたはパスワードが違います');
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('列10 セッションが切れたらログイン画面に戻る', async ({ page }) => {
    await ensureTestUser();
    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();

    // 端末に残ったセッションを捨てて開き直す
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.includes('auth-token')) localStorage.removeItem(key);
      }
    });
    await page.reload();

    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });
});
