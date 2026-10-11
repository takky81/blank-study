import { expect, test, type Locator, type Page } from '@playwright/test';

async function openMenu(page: Page) {
  const menu = page.getByRole('button', { name: /長い語句.*その他の操作/ });
  await menu.focus();
  if (await menu.getAttribute('aria-expanded') !== 'true') {
    await page.keyboard.press('Enter');
  }
}

async function reachWithTab(page: Page, target: Locator, backwards = false) {
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('対象操作へTabキーで到達できませんでした');
}

test('狭幅で横スクロールせず、展開メニューと全行操作をキーボード実行できる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/e2e/harness/question-list.html');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await openMenu(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const row = page.getByRole('heading', { name: /狭幅で折り返される設問/ }).locator('xpath=ancestor::li');
  const deleteButton = row.getByRole('button', { name: '設問を削除' });
  const hitTest = await deleteButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === button || button.contains(hit);
  });
  expect(hitTest).toBe(true);

  const edit = row.getByRole('button', { name: '設問を編集' });
  await reachWithTab(page, edit, true); await page.keyboard.press('Enter');
  await expect(page.getByLabel('操作記録')).toContainText('edit:question-1');

  for (const [name, event] of [
    ['上へ移動', 'reorder:question-1,question-0,question-2'],
    ['下へ移動', 'reorder:question-0,question-1,question-2'],
    ['疑義フラグを解除', 'flag:question-1:doubtFlag'],
    ['解説追加フラグを解除', 'flag:question-1:explanationRequestFlag'],
  ] as const) {
    await openMenu(page);
    const button = row.getByRole('button', { name });
    await reachWithTab(page, button); await page.keyboard.press('Enter');
    await expect(page.getByLabel('操作記録')).toContainText(event);
  }

  await openMenu(page);
  await reachWithTab(page, row.getByRole('button', { name: '設問を無効にする' })); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'キャンセル' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('操作記録')).not.toContainText('active:');

  await openMenu(page);
  await reachWithTab(page, row.getByRole('button', { name: '設問を無効にする' })); await page.keyboard.press('Enter');
  await reachWithTab(page, page.getByRole('button', { name: '無効にする', exact: true })); await page.keyboard.press('Enter');
  await expect(page.getByLabel('操作記録')).toContainText('active:question-1:false');

  await openMenu(page);
  await reachWithTab(page, row.getByRole('button', { name: '設問を有効にする' })); await page.keyboard.press('Enter');
  await reachWithTab(page, page.getByRole('button', { name: '有効にする', exact: true })); await page.keyboard.press('Enter');
  await expect(page.getByLabel('操作記録')).toContainText('active:question-1:true');

  await openMenu(page);
  const deleteOpener = row.getByRole('button', { name: '設問を削除' });
  await reachWithTab(page, deleteOpener); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'キャンセル' })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('操作記録')).not.toContainText('delete:question-1');
  await expect(deleteOpener).toBeFocused();

  await deleteOpener.press('Enter');
  await reachWithTab(page, page.getByRole('button', { name: '削除する' })); await page.keyboard.press('Enter');
  await expect(page.getByLabel('操作記録')).toContainText('delete:question-1');
});
