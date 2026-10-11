import { expect, test, type Page } from '@playwright/test';

const harness = '/e2e/harness/question-bank.html?reset=1';

async function createQuestion(page: Page, text = 'アクセシビリティ設問') {
  await page.getByRole('button', { name: '最初の設問を作成' }).click();
  await page.getByLabel('設問文').fill(text);
  await page.getByLabel('模範解答').fill('模範解答');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: text })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

for (const viewport of [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'narrow', width: 360, height: 740 },
] as const) {
  test(`${viewport.name}: 横スクロールなしで作成・行操作・確認へ到達できる`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(harness);
    await expectNoHorizontalOverflow(page);

    await createQuestion(page, `${viewport.name}設問`);
    await expectNoHorizontalOverflow(page);

    const actionMenu = page.getByRole('button', { name: `「${viewport.name}設問」のその他の操作` });
    if (await actionMenu.count()) await actionMenu.click();
    await page.getByRole('button', { name: '設問を削除' }).click();
    await expect(page.getByRole('dialog', { name: '設問を削除しますか' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'キャンセル' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
}

test('keyboard操作、入力label、flag名、validation alertを支援技術向け名称で公開する', async ({ page }) => {
  await page.goto(harness);
  await page.getByRole('button', { name: '最初の設問を作成' }).focus();
  await page.keyboard.press('Enter');

  await expect(page.getByLabel('設問文')).toBeVisible();
  await expect(page.getByLabel('模範解答')).toBeVisible();
  await expect(page.getByLabel('解説（任意）')).toBeVisible();
  await page.getByRole('button', { name: '選択肢を追加' }).click();
  await expect(page.getByRole('textbox', { name: '選択肢1', exact: true })).toBeFocused();

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByLabel('設問文')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('設問文を入力してください。')).toBeVisible();

  await page.getByLabel('設問文').fill('flag確認設問');
  await page.getByLabel('模範解答').fill('答え');
  await page.getByRole('textbox', { name: '選択肢1', exact: true }).fill('誤答');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const row = page.getByRole('heading', { name: 'flag確認設問' }).locator('xpath=ancestor::li');
  await expect(row).toContainText('疑義フラグ: あり');
  await expect(row).toContainText('解説追加フラグ: あり');
});

test('TabとShift+Tab、EnterとSpaceだけで選択肢編集から保存まで完了できる', async ({ page }) => {
  await page.goto(harness);
  const create = page.getByRole('button', { name: '最初の設問を作成' });
  await create.focus();
  await expect(create).toBeFocused();
  await page.keyboard.press('Enter');

  const questionText = page.getByLabel('設問文');
  await questionText.focus();
  await page.keyboard.type('キーボード設問');
  await page.keyboard.press('Tab');
  const modelAnswer = page.getByLabel('模範解答');
  await expect(modelAnswer).toBeFocused();
  await page.keyboard.type('キーボード解答');

  await page.keyboard.press('Tab');
  const addChoice = page.getByRole('button', { name: '選択肢を追加' });
  await expect(addChoice).toBeFocused();
  await page.keyboard.press('Space');
  const choice = page.getByRole('textbox', { name: '選択肢1', exact: true });
  await expect(choice).toBeFocused();
  await page.keyboard.type('削除する選択肢');

  await page.keyboard.press('Tab');
  const removeChoice = page.getByRole('button', { name: '選択肢1を削除' });
  await expect(removeChoice).toBeFocused();
  await page.keyboard.press('Space');
  await expect(addChoice).toBeFocused();
  await expect(choice).toHaveCount(0);

  await page.keyboard.press('Shift+Tab');
  await expect(modelAnswer).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(addChoice).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('解説（任意）')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'キャンセル' })).toBeFocused();
  await page.keyboard.press('Tab');
  const save = page.getByRole('button', { name: '保存', exact: true });
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'キーボード設問' })).toBeVisible();
});

test('保存中は連打を1回に抑止し、ライト・ダークとも共通theme tokenを反映する', async ({ page }) => {
  await page.goto(harness);
  await page.getByRole('button', { name: '次の保存を遅延させる' }).click();
  await page.getByRole('button', { name: '最初の設問を作成' }).click();
  await page.getByLabel('設問文').fill('連打防止設問');
  await page.getByLabel('模範解答').fill('答え');
  const save = page.getByRole('button', { name: '保存', exact: true });
  await save.dblclick();
  await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled();
  await expect(page.getByText('保存呼出回数: 1')).toBeVisible();
  await expect(page.getByRole('heading', { name: '連打防止設問' })).toBeVisible();

  const light = await page.locator('main').evaluate((element) => ({
    color: getComputedStyle(element).color,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--c-ink').trim(),
  }));
  await page.getByRole('button', { name: 'ダークテーマにする' }).click();
  const dark = await page.locator('main').evaluate((element) => ({
    color: getComputedStyle(element).color,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--c-ink').trim(),
  }));
  expect(light.ink).not.toBe('');
  expect(dark.ink).not.toBe('');
  expect(dark.ink).not.toBe(light.ink);
  expect(dark.color).not.toBe(light.color);
});
