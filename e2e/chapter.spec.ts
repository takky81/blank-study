import { test, expect, type Page } from './fixtures';
import { ensureTestUser, seedSubject, countRows, adminClient } from './db';

/**
 * 決定表「章の管理」 spec/tables/04-chapter.jsonl
 * 列11・列12 は出題の実装後に「出題順」の E2E で確かめる。
 */
test.describe('章の管理', () => {
  /** 教材を1つ作り、編集画面を開く。章は指定した分だけ用意する。 */
  async function openEditor(
    page: Page,
    chapters: { id: string; parentId: string | null; title: string; sortOrder: number }[] = [],
  ): Promise<{ ownerId: string; materialId: string }> {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    const db = adminClient();
    const material = await db
      .from('materials')
      .insert({ name: 'テクノロジ系', subject_id: subjectId, owner_id: ownerId })
      .select('id')
      .single();
    if (material.error) throw material.error;

    for (const c of chapters) {
      const { error } = await db.from('chapters').insert({
        id: c.id,
        material_id: material.data.id,
        parent_id: c.parentId,
        owner_id: ownerId,
        title: c.title,
        sort_order: c.sortOrder,
      });
      if (error) throw error;
    }

    await page.goto(`/materials/${material.data.id}/edit`);
    await expect(page.getByRole('heading', { name: 'テクノロジ系' })).toBeVisible();
    return { ownerId, materialId: material.data.id as string };
  }

  const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

  const treeItems = (page: Page) => page.getByRole('treeitem');

  test('列1 選んでいる章の下に追加する', async ({ signedIn: page }) => {
    await openEditor(page, [{ id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 }]);

    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await page.getByRole('button', { name: '＋ 章' }).click();
    await page.getByLabel('章タイトル').fill('2進数');
    await page.getByRole('button', { name: '作成' }).click();

    await expect(treeItems(page)).toHaveCount(2);
    const child = page.getByRole('treeitem', { name: '2進数' });
    await expect(child).toHaveAttribute('aria-level', '2');
  });

  test('列2 選んでいなければ最上位に追加する', async ({ signedIn: page }) => {
    await openEditor(page, [{ id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 }]);

    await page.getByRole('button', { name: '＋ 章' }).click();
    await page.getByLabel('章タイトル').fill('アルゴリズム');
    await page.getByRole('button', { name: '作成' }).click();

    const added = page.getByRole('treeitem', { name: 'アルゴリズム' });
    await expect(added).toHaveAttribute('aria-level', '1');
  });

  test('列3 空のタイトルは確定できない', async ({ signedIn: page }) => {
    await openEditor(page, [{ id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 }]);

    await page.getByRole('button', { name: '＋ 章' }).click();
    await expect(page.getByRole('button', { name: '作成' })).toBeDisabled();
    await page.getByLabel('章タイトル').fill('   ');
    await expect(page.getByRole('button', { name: '作成' })).toBeDisabled();
  });

  test('列4 章名を変更できる', async ({ signedIn: page }) => {
    await openEditor(page, [{ id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 }]);

    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await page.getByRole('button', { name: '章名を変更' }).click();
    await page.getByLabel('新しい章タイトル').fill('基礎');
    await page.getByRole('button', { name: '確定' }).click();

    await expect(page.getByRole('treeitem', { name: '基礎' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('treeitem', { name: '基礎' })).toBeVisible();
  });

  test('列5 配下がある章の削除は件数を示す', async ({ signedIn: page }) => {
    const { ownerId, materialId } = await openEditor(page, [
      { id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 },
      { id: id(2), parentId: id(1), title: '2進数', sortOrder: 0 },
    ]);
    await adminClient().from('keywords').insert({
      material_id: materialId,
      chapter_id: id(2),
      owner_id: ownerId,
      doc_id: 'k71m2p',
      answers: ['ビット'],
    });
    await page.reload();

    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await page.getByRole('button', { name: '章を削除' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('章 2 件');
    await expect(dialog).toContainText('キーワード 1 件');
  });

  test('列6 削除しても解答履歴は残り、キーワードは出題対象から外れる', async ({
    signedIn: page,
  }) => {
    const { ownerId, materialId } = await openEditor(page, [
      { id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 },
    ]);
    const db = adminClient();
    const keyword = await db
      .from('keywords')
      .insert({
        material_id: materialId,
        chapter_id: id(1),
        owner_id: ownerId,
        doc_id: 'k71m2p',
        answers: ['ビット'],
      })
      .select('id')
      .single();
    if (keyword.error) throw keyword.error;
    await db.from('answer_logs').insert({
      keyword_id: keyword.data.id,
      owner_id: ownerId,
      format: 'text',
      input: 'ビット',
      is_correct: true,
    });
    await page.reload();

    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await page.getByRole('button', { name: '章を削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(treeItems(page)).toHaveCount(0);
    expect(await countRows('chapters', ownerId)).toBe(0);
    expect(await countRows('keywords', ownerId)).toBe(1);
    expect(await countRows('answer_logs', ownerId)).toBe(1);

    const after = await db.from('keywords').select('is_active, chapter_id').single();
    expect(after.data?.is_active).toBe(false);
    expect(after.data?.chapter_id).toBeNull();
  });

  test('列7 同じ親の中で並べ替える', async ({ signedIn: page }) => {
    await openEditor(page, [
      { id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 },
      { id: id(2), parentId: null, title: 'アルゴリズム', sortOrder: 1 },
    ]);

    await page.getByTestId(`chapter-item-${id(2)}`).dispatchEvent('dragstart');
    const gap = page.getByTestId('chapter-gap-root-0');
    await gap.dispatchEvent('dragover');
    await gap.dispatchEvent('drop');

    await expect(treeItems(page).nth(0)).toContainText('アルゴリズム');
    await page.reload();
    await expect(treeItems(page).nth(0)).toContainText('アルゴリズム');
  });

  test('列8 別の章の下へ移すと配下もついていく', async ({ signedIn: page }) => {
    await openEditor(page, [
      { id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 },
      { id: id(2), parentId: id(1), title: '2進数', sortOrder: 0 },
      { id: id(3), parentId: null, title: 'アルゴリズム', sortOrder: 1 },
    ]);

    await page.getByTestId(`chapter-item-${id(1)}`).dispatchEvent('dragstart');
    const target = page.getByTestId(`chapter-item-${id(3)}`);
    await target.dispatchEvent('dragover');
    await target.dispatchEvent('drop');

    await page.reload();
    await expect(page.getByRole('treeitem', { name: 'アルゴリズム' })).toHaveAttribute(
      'aria-level',
      '1',
    );
    await expect(page.getByRole('treeitem', { name: '基礎理論' })).toHaveAttribute(
      'aria-level',
      '2',
    );
    await expect(page.getByRole('treeitem', { name: '2進数' })).toHaveAttribute('aria-level', '3');
  });

  test('列9 自分の子孫の下へは移せない', async ({ signedIn: page }) => {
    await openEditor(page, [
      { id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 },
      { id: id(2), parentId: id(1), title: '2進数', sortOrder: 0 },
    ]);

    await page.getByTestId(`chapter-item-${id(1)}`).dispatchEvent('dragstart');
    const target = page.getByTestId(`chapter-item-${id(2)}`);
    await target.dispatchEvent('dragover');
    await target.dispatchEvent('drop');

    await page.reload();
    await expect(page.getByRole('treeitem', { name: '基礎理論' })).toHaveAttribute(
      'aria-level',
      '1',
    );
    await expect(page.getByRole('treeitem', { name: '2進数' })).toHaveAttribute('aria-level', '2');
  });

  test('列10 別の教材へ移す操作が無い', async ({ signedIn: page }) => {
    await openEditor(page, [{ id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 }]);
    await expect(page.getByRole('button', { name: /教材.*移/ })).toHaveCount(0);
  });

  test('列13 並べ替えに失敗したら元の並びに戻す', async ({ signedIn: page }) => {
    await openEditor(page, [
      { id: id(1), parentId: null, title: '基礎理論', sortOrder: 0 },
      { id: id(2), parentId: null, title: 'アルゴリズム', sortOrder: 1 },
    ]);

    await page.route('**/rest/v1/chapters**', async (route) => {
      if (route.request().method() === 'PATCH') await route.abort('failed');
      else await route.continue();
    });

    await page.getByTestId(`chapter-item-${id(2)}`).dispatchEvent('dragstart');
    const gap = page.getByTestId('chapter-gap-root-0');
    await gap.dispatchEvent('dragover');
    await gap.dispatchEvent('drop');

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(treeItems(page).nth(0)).toContainText('基礎理論');
  });
  test('列14 無い教材の編集画面は戻る導線を出す', async ({ signedIn: page }) => {
    await page.goto('/materials/00000000-0000-4000-8000-0000000000ff/edit');
    await expect(page.getByText('この教材は見つかりませんでした。')).toBeVisible();
    await expect(page.getByRole('link', { name: '科目一覧へ戻る' })).toBeVisible();
    await expect(page.getByRole('tree')).toHaveCount(0);
  });

  test('列15 章が0件なら追加を促す', async ({ signedIn: page }) => {
    await openEditor(page, []);
    await expect(page.getByText('章がありません。「＋ 章」から追加してください。')).toBeVisible();
    await expect(treeItems(page)).toHaveCount(0);
  });

  test('列16 読み込みに失敗したら再試行できる', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '基本情報技術者');
    const db = adminClient();
    const material = await db
      .from('materials')
      .insert({ name: 'テクノロジ系', subject_id: subjectId, owner_id: ownerId })
      .select('id')
      .single();
    if (material.error) throw material.error;
    const { error } = await db.from('chapters').insert({
      material_id: material.data.id,
      parent_id: null,
      owner_id: ownerId,
      title: '基礎理論',
      sort_order: 0,
    });
    if (error) throw error;

    let failing = true;
    await page.route('**/rest/v1/chapters**', async (route) => {
      if (failing && route.request().method() === 'GET') await route.abort('failed');
      else await route.continue();
    });

    await page.goto(`/materials/${material.data.id}/edit`);
    await expect(page.getByRole('alert')).toBeVisible();

    failing = false;
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(page.getByRole('treeitem', { name: '基礎理論' })).toBeVisible();
  });
});
