import { test, expect, signIn, type Page } from './fixtures';
import { ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';

/**
 * app-shell の feature route registry に登録した構造化設問 3 route を実アプリ経由で検証する。
 * Requirements 9.2〜9.6, 9.8〜9.11。
 */
test.describe.configure({ mode: 'serial' });

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 390, height: 844 };
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

type Seed = { subjectId: string; otherSubjectId: string; materialId: string; chapterId: string; keywordId: string };

async function seed(): Promise<Seed> {
  const ownerId = await ensureTestUser();
  await resetData(ownerId);
  const subjectId = await seedSubject(ownerId, '基本情報');
  const otherSubjectId = await seedSubject(ownerId, '応用情報', 1);
  const ids = await seedMaterialWithKeyword(ownerId, subjectId);
  return { subjectId, otherSubjectId, ...ids };
}

function path(page: Page): string {
  return new URL(page.url()).pathname;
}

async function expectLocalError(page: Page, url: string, message: string, back: string) {
  await page.goto(url);
  await expect(page.getByRole('alert')).toContainText(message);
  // 未知routeとして `/` へ置換されない
  expect(path(page)).toBe(new URL(url, 'http://x').pathname);
  await expect(page.getByRole('heading', { name: '科目' })).toHaveCount(0);
  await page.getByRole('button', { name: back }).click();
  await expect(page).not.toHaveURL(new RegExp(new URL(url, 'http://x').pathname));
}

test.describe('構造化設問 feature route の統合', () => {
  test('未認証で各routeを直接開くと既存のログイン画面になる', async ({ page }) => {
    for (const url of ['/questions', '/question-study?scope=subject&scopeId=' + UNKNOWN_UUID, '/question-exchange']) {
      await page.goto(url);
      await expect(page.getByLabel('メールアドレス')).toBeVisible();
      await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
    }
  });

  test('広幅では3導線、狭幅では設問交換を除く2導線が出る', async ({ signedIn: page }) => {
    await page.setViewportSize(WIDE);
    await expect(page.getByRole('link', { name: '設問', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '設問学習', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '設問交換', exact: true })).toBeVisible();

    await page.setViewportSize(NARROW);
    const nav = page.getByTestId('mobile-nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: '設問', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '設問学習', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '設問交換', exact: true })).toHaveCount(0);

    await nav.getByRole('link', { name: '設問学習', exact: true }).click();
    await expect(page).toHaveURL(/\/question-study$/);
    await expect(page.getByRole('heading', { name: '出題範囲を選んでください' })).toBeVisible();
  });

  test('設問バンクをsearch付きで直接開き、再読み込み後も同じ文脈で取消すると許可済みreturnToへ戻る', async ({ page }) => {
    const ids = await seed();
    await signIn(page);
    const url = `/questions?materialId=${ids.materialId}&returnTo=${encodeURIComponent(`/subjects/${ids.subjectId}`)}`;
    await page.goto(url);
    await expect(page.getByRole('heading', { name: '設問バンク' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '設問バンク' })).toBeVisible();
    expect(new URL(page.url()).search).toContain(`materialId=${ids.materialId}`);
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page).toHaveURL(new RegExp(`/subjects/${ids.subjectId}$`));
  });

  test('設問学習をsearch付きで直接開き、再読み込み後に戻ると既定復帰先へ戻る', async ({ page }) => {
    const ids = await seed();
    await signIn(page);
    await page.goto(`/question-study?scope=subject&scopeId=${ids.subjectId}`);
    const back = page.getByRole('button', { name: '戻る' });
    await expect(back).toBeVisible();
    await page.reload();
    await expect(back).toBeVisible();
    expect(new URL(page.url()).search).toContain(`scopeId=${ids.subjectId}`);
    await back.click();
    await expect(page).toHaveURL(/\/questions$/);
  });

  test('設問交換をsearch付きで直接開き、再読み込み後に完了すると許可済みreturnToへ戻る', async ({ page }) => {
    const ids = await seed();
    await signIn(page);
    await page.setViewportSize(WIDE);
    await page.goto(`/question-exchange?subjectId=${ids.subjectId}&materialId=${ids.materialId}&returnTo=%2F`);
    await expect(page.getByRole('heading', { name: '設問交換', level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '設問交換', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: '完了' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();
    expect(path(page)).toBe('/');

    await page.goto('/question-exchange');
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page).toHaveURL(/\/questions$/);
  });

  test('設問バンクの不正parameterと許可外returnToはfeature-local errorと復帰導線を出す', async ({ page }) => {
    const ids = await seed();
    await signIn(page);
    const message = '設問バンクを開けません';
    await expectLocalError(page, '/questions?materialId=not-a-uuid', message, 'ホームへ戻る');
    await expectLocalError(page, `/questions?subjectId=${ids.otherSubjectId}&materialId=${ids.materialId}`, message, 'ホームへ戻る');
    await expectLocalError(page, `/questions?materialId=${ids.materialId}&returnTo=https%3A%2F%2Fevil.example`, message, 'ホームへ戻る');
  });

  test('設問学習のscope不整合と許可外returnToはfeature-local errorと復帰導線を出す', async ({ page }) => {
    const ids = await seed();
    await signIn(page);
    const message = '設問学習を開けません';
    await expectLocalError(page, '/question-study?scope=subject', message, '設問へ戻る');
    await expectLocalError(page, `/question-study?scopeId=${ids.subjectId}`, message, '設問へ戻る');
    await expectLocalError(page, `/question-study?scope=planet&scopeId=${ids.subjectId}`, message, '設問へ戻る');
    await expectLocalError(page, '/question-study?scope=subject&scopeId=xyz', message, '設問へ戻る');
    await expectLocalError(page, '/question-study?returnTo=%2F..%2Fhistory', message, '設問へ戻る');
  });

  test('設問交換の不正parameterと許可外returnToはfeature-local errorと復帰導線を出す', async ({ page }) => {
    const ids = await seed();
    await signIn(page);
    await page.setViewportSize(WIDE);
    const message = '設問交換を開けません';
    await expectLocalError(page, '/question-exchange?chapterId=bad', message, '設問へ戻る');
    await expectLocalError(page, `/question-exchange?subjectId=${ids.otherSubjectId}&materialId=${ids.materialId}`, message, '設問へ戻る');
    await expectLocalError(page, '/question-exchange?returnTo=%2F%2Fevil.example', message, '設問へ戻る');
  });
});
