import { test, expect, type Page } from './fixtures';
import {
  ensureTestUser,
  seedSubject,
  seedMaterialWithKeyword,
  countRows,
  adminClient,
  seedManyKeywords,
} from './db';

/** 決定表「教材の管理」 spec/tables/03-material.jsonl */
test.describe('教材の管理', () => {
  const rows = (page: Page) => page.getByRole('listitem');

  /** 科目を1つ作り、その教材一覧を開く。 */
  async function openSubject(page: Page, name = '基本情報技術者'): Promise<string> {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, name);
    await page.goto(`/subjects/${subjectId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    return subjectId;
  }

  test('列1 教材を追加できる（表示中の科目の末尾に置く）', async ({ signedIn: page }) => {
    await openSubject(page);
    for (const name of ['テクノロジ系', 'マネジメント系']) {
      await page.getByLabel('教材名').fill(name);
      await page.getByRole('button', { name: '＋ 教材を追加' }).click();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(1)).toContainText('マネジメント系');
  });

  test('列2 空の名前は追加できない', async ({ signedIn: page }) => {
    await openSubject(page);
    await expect(page.getByRole('button', { name: '＋ 教材を追加' })).toBeDisabled();
    await page.getByLabel('教材名').fill('   ');
    await expect(page.getByRole('button', { name: '＋ 教材を追加' })).toBeDisabled();
  });

  test('列3 同じ名前の教材を作れる', async ({ signedIn: page }) => {
    await openSubject(page);
    for (let i = 0; i < 2; i += 1) {
      await page.getByLabel('教材名').fill('テクノロジ系');
      await page.getByRole('button', { name: '＋ 教材を追加' }).click();
      await expect(rows(page)).toHaveCount(i + 1);
    }
  });

  test('列4 教材を作ると最上位の章が1件できる', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    await openSubject(page);

    await page.getByLabel('教材名').fill('テクノロジ系');
    await page.getByRole('button', { name: '＋ 教材を追加' }).click();
    await expect(rows(page)).toHaveCount(1);

    expect(await countRows('chapters', ownerId)).toBe(1);
    const { data } = await adminClient()
      .from('chapters')
      .select('parent_id')
      .eq('owner_id', ownerId)
      .single();
    expect(data?.parent_id).toBeNull();
  });

  test('列5 教材名を変更できる', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.goto(`/subjects/${subjectId}`);

    await page.getByRole('button', { name: '名前を変更' }).click();
    await page.getByLabel('新しい教材名').fill('テクノロジ');
    await page.getByRole('button', { name: '確定' }).click();

    await expect(page.getByText('テクノロジ', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('テクノロジ', { exact: true })).toBeVisible();
  });

  test('列7 削除の確認で消える件数を示す', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.goto(`/subjects/${subjectId}`);

    await page.getByRole('button', { name: '削除' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('キーワード 1 件');
    await expect(dialog).toContainText('解答履歴 1 件');
  });

  test('列6 削除すると章・キーワード・解答履歴も消える', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.goto(`/subjects/${subjectId}`);

    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByText('教材がまだありません')).toBeVisible();
    expect(await countRows('materials', ownerId)).toBe(0);
    expect(await countRows('chapters', ownerId)).toBe(0);
    expect(await countRows('keywords', ownerId)).toBe(0);
    expect(await countRows('answer_logs', ownerId)).toBe(0);
    // 科目そのものは残る
    expect(await countRows('subjects', ownerId)).toBe(1);
  });

  test('列8 並べ替えが保存される', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    const db = adminClient();
    for (const [i, name] of ['テクノロジ系', 'マネジメント系', 'ストラテジ系'].entries()) {
      await db.from('materials').insert({
        name,
        subject_id: subjectId,
        owner_id: ownerId,
        sort_order: i,
      });
    }
    await page.goto(`/subjects/${subjectId}`);
    await expect(rows(page)).toHaveCount(3);

    const from = rows(page).nth(2);
    const to = rows(page).nth(0);
    await from.dispatchEvent('dragstart');
    await to.dispatchEvent('dragover');
    await to.dispatchEvent('drop');

    await expect(rows(page).nth(0)).toContainText('ストラテジ系');
    await page.reload();
    await expect(rows(page).nth(0)).toContainText('ストラテジ系');
  });

  test('列9 教材を別の科目へ移す操作が無い', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.goto(`/subjects/${subjectId}`);

    await expect(page.getByRole('button', { name: /科目.*移/ })).toHaveCount(0);
    await expect(page.getByText('エクスポートして別の科目に取り込む')).toBeVisible();
  });

  test('列10 教材が無いときは案内を出し、科目全体の導線を出さない', async ({ signedIn: page }) => {
    await openSubject(page);
    await expect(page.getByText('教材がまだありません')).toBeVisible();
    await expect(page.getByRole('button', { name: '科目全体で解答' })).toHaveCount(0);
  });

  test('列11 キーワードがあれば科目全体と教材ごとの両方から始められる', async ({
    signedIn: page,
  }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.goto(`/subjects/${subjectId}`);

    await expect(page.getByRole('button', { name: '科目全体で解答' })).toBeEnabled();
    await expect(page.getByRole('button', { name: '解答', exact: true })).toBeEnabled();
  });

  test('列12 キーワードが0件なら科目全体で解答を始められない', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await adminClient()
      .from('materials')
      .insert({ name: 'テクノロジ系', subject_id: subjectId, owner_id: ownerId });
    await page.goto(`/subjects/${subjectId}`);

    await expect(page.getByRole('button', { name: '科目全体で解答' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '解答', exact: true })).toBeDisabled();
  });

  test('列13 削除に失敗しても一覧が壊れない', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    await seedMaterialWithKeyword(ownerId, subjectId);
    await page.goto(`/subjects/${subjectId}`);

    await page.route('**/rest/v1/materials**', async (route) => {
      if (route.request().method() === 'DELETE') await route.abort('failed');
      else await route.continue();
    });

    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('テクノロジ系', { exact: true })).toBeVisible();
    expect(await countRows('materials', ownerId)).toBe(1);
  });

  test('列14 1000件を超えても一覧の件数と今日の問題数が頭打ちにならない', async ({
    signedIn: page,
  }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '応用情報技術者');
    const { materialId, chapterId } = await seedMaterialWithKeyword(ownerId, subjectId);
    await seedManyKeywords({ ownerId, materialId, chapterId, count: 1001 });
    await page.goto(`/subjects/${subjectId}`);

    // 元からある1件と合わせて 1002 件。未出題は今日の復習に数える
    const row = rows(page).filter({ hasText: 'テクノロジ系' });
    await expect(row).toContainText('キーワード 1002');
    await expect(row).toContainText('今日 1002 問');
  });

  test('列15 1000件を超えても削除の確認に全件を示す', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '応用情報技術者');
    const { materialId, chapterId } = await seedMaterialWithKeyword(ownerId, subjectId);
    await seedManyKeywords({ ownerId, materialId, chapterId, count: 1001 });
    await page.goto(`/subjects/${subjectId}`);

    await page.getByRole('button', { name: '削除' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('キーワード 1002 件');
    await expect(dialog).toContainText('解答履歴 1 件');
  });
});
