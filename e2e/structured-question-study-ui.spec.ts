import { adminClient, ensureTestUser, seedMaterialWithKeyword, seedSubject } from './db';
import { expect, test, type Page } from './fixtures';

/**
 * 構造化設問学習のレスポンシブ・アクセシビリティ回帰（要件 8.4〜8.7）。
 * 本番routeを認証済みharness（e2e/harness/question-study.html）で描画する。
 */
test.describe.configure({ mode: 'serial' });

const LONG = 'とても長い設問文'.repeat(12);

async function seed(ownerId: string) {
  const subjectId = await seedSubject(ownerId, 'UI科目');
  const { materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId);
  const rows = [
    { question_text: LONG, model_answer: 'ビット', choices: ['バイト', 'ワード'], explanation: '情報量の最小単位', sort_order: 0 },
    { question_text: '記述の設問', model_answer: 'ニブル', choices: [], explanation: null, sort_order: 1 },
  ].map((row) => ({ ...row, owner_id: ownerId, material_id: materialId, keyword_id: keywordId }));
  const inserted = await adminClient().from('structured_questions').insert(rows);
  if (inserted.error) throw inserted.error;
  return { subjectId, materialId, keywordId };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function start(page: Page, keywordId: string, mode: '自動' | '記述式') {
  await page.goto(`/e2e/harness/question-study.html?scope=keyword&scopeId=${keywordId}`);
  await expect(page.getByText('対象 2 問')).toBeVisible();
  await page.getByRole('radiogroup', { name: '出題順' }).getByLabel('順番どおり').check();
  await page.getByRole('radiogroup', { name: '解答形式' }).getByLabel(mode).check();
  await page.getByRole('button', { name: '学習を開始' }).click();
}

for (const viewport of [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'narrow', width: 360, height: 740 },
] as const) {
  test(`${viewport.name}: 横スクロールなしで設定・選択式・記述式・結果とflag・完了へ到達できる`, async ({ signedIn: page }) => {
    const owner = await ensureTestUser();
    const s = await seed(owner);
    await page.setViewportSize(viewport);

    await page.goto('/e2e/harness/question-study.html');
    await expect(page.getByLabel('科目')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await start(page, s.keywordId, '自動');
    const choices = page.getByRole('radiogroup', { name: '選択肢' });
    await expect(choices).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await choices.getByLabel('ビット', { exact: true }).check();
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByRole('status').getByText('正解', { exact: true })).toBeVisible();
    await expect(page.getByLabel('内容に疑義がある')).toBeVisible();
    await expect(page.getByLabel('解説の追加を希望する')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '次の問題へ' }).click();

    await expect(page.getByLabel('解答')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByLabel('解答').fill('ニブル');
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByRole('button', { name: '次の問題へ' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '次の問題へ' }).click();

    await expect(page.getByRole('heading', { name: '学習が終わりました' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test('範囲選択・形式選択・回答・flag・次の操作をキーボードだけで完了でき、各要素に名前がある', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seed(owner);
  await page.goto('/e2e/harness/question-study.html');

  await page.getByRole('combobox', { name: '科目' }).selectOption(s.subjectId);
  await page.getByRole('combobox', { name: '教材' }).selectOption(s.materialId);
  await page.getByRole('combobox', { name: 'キーワード' }).selectOption(s.keywordId);
  const confirm = page.getByRole('button', { name: 'この範囲で設定する' });
  await confirm.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('対象 2 問')).toBeVisible();

  // 出題順・解答形式は名前付きradioで、Space・矢印キーで選べる。
  const order = page.getByRole('radiogroup', { name: '出題順' });
  const orderTarget = order.getByRole('radio', { name: '順番どおり' });
  await expect(orderTarget).toBeVisible();
  const mode = page.getByRole('radiogroup', { name: '解答形式' });
  for (const name of ['自動', '選択式', '記述式']) await expect(mode.getByRole('radio', { name })).toBeVisible();
  await order.getByRole('radio').first().focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 4 && !(await orderTarget.isChecked()); i += 1) await page.keyboard.press('ArrowRight');
  await expect(orderTarget).toBeChecked();
  await mode.getByRole('radio', { name: '自動' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await expect(mode.getByRole('radio', { name: '選択式' })).toBeChecked();
  await page.getByRole('button', { name: '学習を開始' }).focus();
  await page.keyboard.press('Enter');

  // 選択肢: 名前付きradio、矢印で移動、Enterで送信。
  const choices = page.getByRole('radiogroup', { name: '選択肢' });
  const bit = choices.getByRole('radio', { name: 'ビット', exact: true });
  await expect(bit).toBeVisible();
  await choices.getByRole('radio').first().focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 4 && !(await bit.isChecked()); i += 1) await page.keyboard.press('ArrowDown');
  await expect(bit).toBeChecked();
  await page.keyboard.press('Enter');
  const status = page.getByRole('status').filter({ hasText: '正解' });
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status.getByText('正解', { exact: true })).toBeVisible();

  // flagは名前付きcheckboxで、Spaceで切り替える。
  const doubt = page.getByRole('checkbox', { name: '内容に疑義がある' });
  await doubt.focus();
  await page.keyboard.press('Space');
  await expect(doubt).toBeChecked();
  await expect(page.getByText('フラグを保存しました')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '解説の追加を希望する' })).not.toBeChecked();

  await page.getByRole('button', { name: '次の問題へ' }).focus();
  await page.keyboard.press('Enter');
  const answer = page.getByRole('textbox', { name: '解答' });
  await answer.focus();
  await page.keyboard.type('ちがう');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').getByText('不正解', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '次の問題へ' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '学習が終わりました' })).toBeVisible();
});

test('記録errorはrole=alertで、候補読取失敗も操作文脈つきalertで通知する', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seed(owner);
  await page.route('**/rest/v1/rpc/record_structured_question_answer', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await start(page, s.keywordId, '記述式');
  await page.getByLabel('解答').fill('ビット');
  await page.getByRole('button', { name: '解答する' }).click();
  await expect(page.getByRole('alert')).toContainText('この回答は未記録です');
  await expect(page.getByRole('status').getByText('正解', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '記録を再試行' })).toBeVisible();
  await page.unroute('**/rest/v1/rpc/record_structured_question_answer');

  await page.route('**/rest/v1/structured_questions*', (route) => route.abort());
  await page.goto(`/e2e/harness/question-study.html?scope=keyword&scopeId=${s.keywordId}`);
  await expect(page.getByRole('alert')).toContainText('設問を読み込めませんでした');
  await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible();
});

test('候補読込中は空状態と区別できる進行状態をstatusで示す', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seed(owner);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/rest/v1/structured_questions*', async (route) => { await gate; await route.continue(); });
  await page.goto(`/e2e/harness/question-study.html?scope=keyword&scopeId=${s.keywordId}`);
  const loading = page.getByRole('status').filter({ hasText: '読み込んでいます' });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('この範囲に出題できる設問はありません')).toHaveCount(0);
  release();
  await expect(page.getByText('対象 2 問')).toBeVisible();
  await expect(loading).toHaveCount(0);
  await page.unroute('**/rest/v1/structured_questions*');

  const emptySubject = await seedSubject(owner, '空の科目UI', 1);
  await page.goto(`/e2e/harness/question-study.html?scope=subject&scopeId=${emptySubject}`);
  await expect(page.getByText('この範囲に出題できる設問はありません')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '読み込んでいます' })).toHaveCount(0);
});

test('ライト・ダークとも既存theme tokenで設問と結果を描画する', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seed(owner);
  await start(page, s.keywordId, '記述式');
  await page.getByLabel('解答').fill('ビット');
  await page.getByRole('button', { name: '解答する' }).click();
  await expect(page.getByRole('button', { name: '次の問題へ' })).toBeVisible();

  const read = () => page.locator('section.card').evaluate((element) => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--c-ink').trim(),
  }));
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  const light = await read();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  // .card は色を120msで遷移させるため、遷移完了まで待つ。
  await expect.poll(async () => (await read()).background).not.toBe(light.background);
  await expect.poll(async () => (await read()).color).not.toBe(light.color);
  const dark = await read();
  expect(light.ink).not.toBe('');
  expect(dark.ink).not.toBe('');
  expect(dark.ink).not.toBe(light.ink);
  await expectNoHorizontalOverflow(page);
});
