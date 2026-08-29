import { test, expect } from './fixtures';
import { ensureTestUser, seedSubject, seedMaterialWithKeyword, countRows } from './db';

/** 決定表「科目の管理」 spec/tables/02-subject.jsonl */
test.describe('科目の管理', () => {
  const rows = (page: import('@playwright/test').Page) => page.getByRole('listitem');

  test('列1 科目を追加できる（一覧の末尾に置く）', async ({ signedIn: page }) => {
    for (const name of ['基本情報技術者', '生物基礎']) {
      await page.getByLabel('科目名').fill(name);
      await page.getByRole('button', { name: '＋ 科目を追加' }).click();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(1)).toContainText('生物基礎');
  });

  test('列2 空の名前は追加できない', async ({ signedIn: page }) => {
    await expect(page.getByRole('button', { name: '＋ 科目を追加' })).toBeDisabled();
  });

  test('列3 空白だけの名前は追加できない', async ({ signedIn: page }) => {
    await page.getByLabel('科目名').fill('   ');
    await expect(page.getByRole('button', { name: '＋ 科目を追加' })).toBeDisabled();
    await page.getByLabel('科目名').fill('　');
    await expect(page.getByRole('button', { name: '＋ 科目を追加' })).toBeDisabled();
  });

  test('列4 同じ名前の科目を作れる', async ({ signedIn: page }) => {
    for (let i = 0; i < 2; i += 1) {
      await page.getByLabel('科目名').fill('世界史');
      await page.getByRole('button', { name: '＋ 科目を追加' }).click();
      await expect(rows(page)).toHaveCount(i + 1);
    }
    await expect(page.getByText('世界史', { exact: true })).toHaveCount(2);
  });

  test('列5 科目名を変更できる', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    await seedSubject(ownerId, '基本情報技術者');
    await page.reload();

    await page.getByRole('button', { name: '名前を変更' }).click();
    await page.getByLabel('新しい科目名').fill('基本情報');
    await page.getByRole('button', { name: '確定' }).click();

    await expect(page.getByText('基本情報', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('基本情報', { exact: true })).toBeVisible();
  });

  test('列6 配下が無い科目でも削除の確認が出る', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    await seedSubject(ownerId, '世界史');
    await page.reload();

    await page.getByRole('button', { name: '削除' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('「世界史」を削除しますか');
    await expect(dialog).toContainText('この科目には教材がありません');
  });

  test('列7 配下がある科目は消える件数を示す', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.reload();

    await page.getByRole('button', { name: '削除' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('教材 1 件');
    await expect(dialog).toContainText('キーワード 1 件');
    await expect(dialog).toContainText('解答履歴 1 件');
  });

  test('列8 削除すると配下の教材・キーワード・解答履歴も消える', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.reload();

    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByText('科目がまだありません')).toBeVisible();
    expect(await countRows('materials', ownerId)).toBe(0);
    expect(await countRows('chapters', ownerId)).toBe(0);
    expect(await countRows('keywords', ownerId)).toBe(0);
    expect(await countRows('answer_logs', ownerId)).toBe(0);
  });

  test('列9 確認をキャンセルすると消えない', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    await seedSubject(ownerId, '世界史');
    await page.reload();

    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: 'キャンセル' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('世界史', { exact: true })).toBeVisible();
    expect(await countRows('subjects', ownerId)).toBe(1);
  });

  test('列10 並べ替えが保存される', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    await seedSubject(ownerId, '基本情報技術者', 0);
    await seedSubject(ownerId, '生物基礎', 1);
    await seedSubject(ownerId, '世界史', 2);
    await page.reload();
    await expect(rows(page)).toHaveCount(3);

    // HTML5 のドラッグはイベントを直接送って再現する
    const from = rows(page).nth(2);
    const to = rows(page).nth(0);
    await from.dispatchEvent('dragstart');
    await to.dispatchEvent('dragover');
    await to.dispatchEvent('drop');

    await expect(rows(page).nth(0)).toContainText('世界史');
    await page.reload();
    await expect(rows(page).nth(0)).toContainText('世界史');
    await expect(rows(page).nth(1)).toContainText('基本情報技術者');
    await expect(rows(page).nth(2)).toContainText('生物基礎');
  });

  test('列11 科目が無いときは案内を出す', async ({ signedIn: page }) => {
    await expect(page.getByText('科目がまだありません')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test('列12 追加に失敗しても一覧が壊れない', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    await seedSubject(ownerId, '世界史');
    await page.reload();
    await expect(rows(page)).toHaveCount(1);

    await page.route('**/rest/v1/subjects**', async (route) => {
      if (route.request().method() === 'POST') await route.abort('failed');
      else await route.continue();
    });

    await page.getByLabel('科目名').fill('生物基礎');
    await page.getByRole('button', { name: '＋ 科目を追加' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: '再試行' })).toBeVisible();
    await expect(page.getByText('世界史', { exact: true })).toBeVisible();
    expect(await countRows('subjects', ownerId)).toBe(1);
  });
});
