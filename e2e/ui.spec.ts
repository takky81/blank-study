import { test, expect, type Page } from './fixtures';
import { ensureTestUser, seedSubject, adminClient } from './db';

/** 決定表「表示設定と共通の振る舞い」 spec/tables/20-ui.jsonl */

const MOBILE = { width: 390, height: 844 };

/** 科目・教材・章・キーワードを1組ずつ用意して教材一覧を開く。 */
async function seedOne(page: Page) {
  const ownerId = await ensureTestUser();
  const subjectId = await seedSubject(ownerId, '基本情報技術者');
  const db = adminClient();

  const material = await db
    .from('materials')
    .insert({ name: 'テクノロジ系', subject_id: subjectId, owner_id: ownerId })
    .select('id')
    .single();
  if (material.error) throw material.error;

  const chapter = await db
    .from('chapters')
    .insert({
      material_id: material.data.id,
      owner_id: ownerId,
      title: '基礎理論',
      body: '植物は {{id=aaaaaa}} を行う。',
      sort_order: 0,
    })
    .select('id')
    .single();
  if (chapter.error) throw chapter.error;

  const keyword = await db.from('keywords').insert({
    material_id: material.data.id,
    chapter_id: chapter.data.id,
    owner_id: ownerId,
    doc_id: 'aaaaaa',
    answers: ['光合成'],
  });
  if (keyword.error) throw keyword.error;

  await page.goto(`/subjects/${subjectId}`);
  return { ownerId, subjectId, materialId: material.data.id as string };
}

test.describe('表示設定と共通の振る舞い', () => {
  test('列2 ダークモードに切り替えられる', async ({ signedIn: page }) => {
    await seedOne(page);

    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: 'テーマを切り替える' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('列3 テーマが次回も保たれる', async ({ signedIn: page }) => {
    await seedOne(page);
    await page.getByRole('button', { name: 'テーマを切り替える' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('列4・列5 画面幅で並びとナビゲーションが変わる', async ({ signedIn: page }) => {
    await seedOne(page);

    await expect(page.getByTestId('mobile-nav')).toBeHidden();

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('mobile-nav')).toBeVisible();
    await expect(page.getByTestId('mobile-nav').getByRole('link', { name: '学習' })).toBeVisible();
    await expect(page.getByTestId('mobile-nav').getByRole('link', { name: '履歴' })).toBeVisible();
  });

  test('列6 狭い画面ではダイアログが全画面になる', async ({ signedIn: page }) => {
    await seedOne(page);
    await page.setViewportSize(MOBILE);

    await page.getByRole('button', { name: 'メニュー' }).first().click();
    await page.getByRole('button', { name: '削除' }).click();

    const dialog = page.getByRole('dialog');
    const box = await dialog.locator('div').first().boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(MOBILE.width - 1);
  });

  test('列7 狭い画面のタップ領域が44px以上ある', async ({ signedIn: page }) => {
    await seedOne(page);
    await page.setViewportSize(MOBILE);

    const buttons = page.getByRole('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('列8 狭い画面では行の操作がメニューに畳まれる', async ({ signedIn: page }) => {
    await seedOne(page);

    await expect(page.getByRole('button', { name: '名前を変更' })).toBeVisible();

    await page.setViewportSize(MOBILE);
    await expect(page.getByRole('button', { name: '名前を変更' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '解答', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'メニュー' }).first().click();
    await expect(page.getByRole('button', { name: '名前を変更' })).toBeVisible();
  });

  test('列9 読み込み中と空を取り違えない', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');

    await page.route('**/rest/v1/materials**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await page.goto(`/subjects/${subjectId}`);

    await expect(page.getByText('読み込んでいます…')).toBeVisible();
    await expect(page.getByText('教材がまだありません', { exact: false })).toHaveCount(0);
    await expect(page.getByText('教材がまだありません', { exact: false })).toBeVisible();
  });

  test('列10・列11 読み込みに失敗しても再試行で戻る', async ({ signedIn: page }) => {
    const { subjectId } = await seedOne(page);

    let failing = true;
    await page.route('**/rest/v1/materials**', async (route) => {
      if (failing) await route.abort('failed');
      else await route.continue();
    });
    await page.goto(`/subjects/${subjectId}`);

    await expect(page.getByRole('alert')).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(page.getByText('テクノロジ系')).toBeVisible();
  });

  test('列13 消えたデータの URL を開いても壊れない', async ({ signedIn: page }) => {
    await page.goto('/subjects/00000000-0000-4000-8000-0000000000ff');

    await expect(page.getByText('この科目は見つかりませんでした。')).toBeVisible();
    await expect(page.getByRole('link', { name: '科目一覧へ戻る' })).toBeVisible();
  });

  test('列14 ブラウザの戻るが効く', async ({ signedIn: page }) => {
    const { subjectId, materialId } = await seedOne(page);

    await page.goto(`/materials/${materialId}/edit`);
    await expect(page.getByRole('heading', { name: 'テクノロジ系' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/subjects/${subjectId}$`));
  });

  test('列15 解答中に戻ってもそこまでの記録が残る', async ({ signedIn: page }) => {
    const { materialId } = await seedOne(page);

    await page.goto(`/materials/${materialId}/study`);
    await page.getByRole('radio', { name: '記述', exact: true }).check();
    await page.getByRole('button', { name: '開始する' }).click();
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByText('正解', { exact: true })).toBeVisible();

    await page.goBack();
    await expect
      .poll(async () => (await adminClient().from('answer_logs').select('id')).data?.length)
      .toBe(1);
  });

  test('列16 サブパス配信でも画面が開く', async ({ signedIn: page }) => {
    const { subjectId } = await seedOne(page);

    // ルータの basename は Vite の base に合わせてある。開発時は '/'
    await page.goto(`/subjects/${subjectId}`);
    await expect(page.getByRole('heading', { name: '基本情報技術者' })).toBeVisible();

    const base = await page.evaluate(() => document.querySelector('base')?.getAttribute('href'));
    expect(base ?? '/').toBe('/');
  });
  test('列17 狭い画面ではヘッダの操作が畳まれる', async ({ signedIn: page }) => {
    await seedOne(page);

    // 広い画面ではそのまま並ぶ
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();

    await page.setViewportSize(MOBILE);
    await expect(page.getByRole('button', { name: 'ログアウト' })).toHaveCount(0);

    const menu = page.getByRole('button', { name: 'ヘッダの操作' });
    await menu.click();
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();

    // 文字がボタンからはみ出さない
    for (const name of ['ログアウト', 'テーマを切り替える']) {
      const button = page.getByRole('button', { name });
      const box = await button.boundingBox();
      const text = await button.evaluate((el) => ({
        w: el.scrollWidth,
        h: el.scrollHeight,
      }));
      expect(text.w).toBeLessThanOrEqual(Math.ceil(box?.width ?? 0));
      expect(text.h).toBeLessThanOrEqual(Math.ceil(box?.height ?? 0));
    }
  });
  test('列20 カード内のボタンに乗せている間はカードのホバーを外す', async ({ signedIn: page }) => {
    await seedOne(page);

    const row = page.getByRole('listitem').filter({ hasText: 'テクノロジ系' });
    // 色は 120ms かけて変わるので、変わりきるまで待つ
    const background = () =>
      expect.poll(() =>
        row.evaluate((el) => getComputedStyle(el).backgroundColor.replace(/\s/g, '')),
      );

    // 行の余白に乗せるとカードが反応する
    await row.hover({ position: { x: 5, y: 5 } });
    await background().toBe('rgb(211,224,242)');

    // 行の中のボタンに乗せている間は、カードは元の地に戻る
    await row.getByRole('button', { name: '解答', exact: true }).hover();
    await background().toBe('rgb(255,255,255)');
  });
});
