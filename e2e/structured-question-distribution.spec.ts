import { adminClient, ensureTestUser, seedMaterialWithKeyword, seedSubject } from './db';
import { expect, test, type Page } from './fixtures';

/**
 * 科目単位の成績分布（要件 9）。本番routeを認証済みharness（e2e/harness/question-study.html）で描画する。
 */
test.describe.configure({ mode: 'serial' });

async function seed(ownerId: string, questionCount: number) {
  const subjectId = await seedSubject(ownerId, '分布科目');
  const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId);
  const db = adminClient();
  const rows = Array.from({ length: questionCount }, (_, index) => ({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId,
    question_text: `分布の設問${index}`, model_answer: `答${index}`, choices: [], sort_order: index,
  }));
  const ids: string[] = [];
  for (let start = 0; start < rows.length; start += 500) {
    const inserted = await db.from('structured_questions').insert(rows.slice(start, start + 500)).select('id');
    if (inserted.error) throw inserted.error;
    ids.push(...(inserted.data ?? []).map((row) => row.id as string));
  }
  // 1問目は2回中2回正解、2問目は2回中1回正解、残りは未出題。
  const stats = await db.from('structured_question_stats').insert([
    { question_id: ids[0], owner_id: ownerId, asked_count: 2, correct_count: 2 },
    { question_id: ids[1], owner_id: ownerId, asked_count: 2, correct_count: 1 },
  ]);
  if (stats.error) throw stats.error;
  return { subjectId };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('科目選択→成績分布→単位切替→戻るで科目選択が復元される', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const { subjectId } = await seed(owner, 3);
  await page.setViewportSize({ width: 390, height: 800 });

  await page.goto('/e2e/harness/question-study.html');
  const open = page.getByRole('button', { name: '成績分布' });
  await expect(open).toBeDisabled();
  await page.getByLabel('科目').selectOption(subjectId);
  await open.click();

  await expect(page.getByRole('radio', { name: '設問ごと' })).toBeChecked();
  await expect(page.getByLabel('未出題 1件')).toBeVisible();
  await expect(page.getByLabel('100% 1件')).toBeVisible();
  await expect(page.getByLabel('50%以上60%未満 1件')).toBeVisible();
  await expect(page.getByLabel('2回 2件')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('radio', { name: 'キーワードごと' }).check();
  await expect(page.getByLabel('70%以上80%未満 1件')).toBeVisible();
  await expect(page.getByLabel('4回 1件')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: '範囲選択へ戻る' }).click();
  await expect(page.getByLabel('科目')).toHaveValue(subjectId);
});

test('不正なsubjectIdでは集計せず範囲選択への導線を出す', async ({ signedIn: page }) => {
  await page.goto('/e2e/harness/question-study.html?route=distribution&subjectId=abc');
  await expect(page.getByRole('alert')).toContainText('成績分布を開けません');
  await page.getByRole('button', { name: '範囲選択へ戻る' }).click();
  await expect(page.getByLabel('科目')).toBeVisible();
});

test('1,001問の科目でも全件を集計する', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const { subjectId } = await seed(owner, 1001);
  await page.goto(`/e2e/harness/question-study.html?route=distribution&subjectId=${subjectId}`);
  await expect(page.getByLabel('未出題 999件')).toBeVisible();
  await expect(page.getByRole('region', { name: '正答率' }).getByText('全1001件')).toBeVisible();
  await page.getByRole('radio', { name: 'キーワードごと' }).check();
  await expect(page.getByRole('region', { name: '正答率' }).getByText('全1件')).toBeVisible();
});
