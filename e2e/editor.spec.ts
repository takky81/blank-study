import { test, expect, type Page } from './fixtures';
import { ensureTestUser, seedSubject, adminClient } from './db';

/**
 * 決定表「編集画面の操作」 spec/tables/05-editor-ui.jsonl
 * 決定表「キーワードIDの採番」列1 / 「保存と正規化」 spec/tables/08-save-normalize.jsonl
 */
test.describe('編集画面', () => {
  type Seed = {
    body?: string;
    keywords?: { docId: string; answers: string[]; tags?: string[]; wrong?: string[] }[];
    secondChapter?: boolean;
  };

  /** 教材と章を1つ用意して編集画面を開き、章を選ぶ。 */
  async function openChapter(page: Page, seed: Seed = {}) {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '生物');
    const db = adminClient();

    const material = await db
      .from('materials')
      .insert({ name: '細胞と代謝', subject_id: subjectId, owner_id: ownerId })
      .select('id')
      .single();
    if (material.error) throw material.error;
    const materialId = material.data.id as string;

    const chapter = await db
      .from('chapters')
      .insert({
        material_id: materialId,
        owner_id: ownerId,
        title: '光合成',
        sort_order: 0,
        body: seed.body ?? '',
      })
      .select('id')
      .single();
    if (chapter.error) throw chapter.error;

    if (seed.secondChapter) {
      const { error } = await db.from('chapters').insert({
        material_id: materialId,
        owner_id: ownerId,
        title: '呼吸',
        sort_order: 1,
        body: '',
      });
      if (error) throw error;
    }

    for (const k of seed.keywords ?? []) {
      const { error } = await db.from('keywords').insert({
        material_id: materialId,
        chapter_id: chapter.data.id,
        owner_id: ownerId,
        doc_id: k.docId,
        answers: k.answers,
        tags: k.tags ?? [],
        wrong_choices: k.wrong ?? [],
      });
      if (error) throw error;
    }

    await page.goto(`/materials/${materialId}/edit`);
    await page.getByRole('treeitem', { name: '光合成' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    return { ownerId, materialId, chapterId: chapter.data.id as string };
  }

  const editor = (page: Page) => page.getByLabel('本文');
  const preview = (page: Page) => page.getByTestId('preview');

  /** 編集領域の一部を選択する。 */
  async function selectInEditor(page: Page, start: number, end: number) {
    await editor(page).evaluate(
      (el, range) => {
        const area = el as HTMLTextAreaElement;
        area.focus();
        area.setSelectionRange(range.start, range.end);
        area.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      },
      { start, end },
    );
  }

  /** プレビューの中の文字を選択する。 */
  async function selectInPreview(page: Page, text: string) {
    await page.evaluate((needle) => {
      const root = document.querySelector('[data-testid="preview"]');
      if (!root) throw new Error('プレビューが無い');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const at = node.textContent?.indexOf(needle) ?? -1;
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          return;
        }
        node = walker.nextNode();
      }
      throw new Error('選択する文字が見つからない');
    }, text);
  }

  test('列1 章を選ぶと展開形式の本文とプレビューが出る', async ({ signedIn: page }) => {
    await openChapter(page, {
      body: '## 光合成\n\n植物は {{id=a3f9k2}} を行う。',
      keywords: [{ docId: 'a3f9k2', answers: ['光合成'], tags: ['生物'], wrong: ['呼吸'] }],
    });

    await expect(editor(page)).toHaveValue(
      '## 光合成\n\n植物は {{光合成|id=a3f9k2|tags=生物|wrong=呼吸}} を行う。',
    );
    await expect(preview(page).getByRole('heading', { name: '光合成' })).toBeVisible();
    await expect(preview(page).getByTestId('blank-a3f9k2')).toBeVisible();
  });

  test('列16 章を選ぶまで編集領域を出さない', async ({ signedIn: page }) => {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '生物');
    const db = adminClient();
    const material = await db
      .from('materials')
      .insert({ name: '細胞と代謝', subject_id: subjectId, owner_id: ownerId })
      .select('id')
      .single();
    if (material.error) throw material.error;
    const { error } = await db.from('chapters').insert({
      material_id: material.data.id,
      owner_id: ownerId,
      title: '光合成',
      sort_order: 0,
      body: '',
    });
    if (error) throw error;

    await page.goto(`/materials/${material.data.id}/edit`);
    await expect(page.getByText('左の一覧から章を選んでください。')).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
  });

  test('列2 入力するとプレビューが追随し未保存になる', async ({ signedIn: page }) => {
    await openChapter(page, { body: '古い本文' });

    await editor(page).fill('# 新しい見出し');
    await expect(preview(page).getByRole('heading', { name: '新しい見出し' })).toBeVisible();
    await expect(page.getByText('未保存の変更あり')).toBeVisible();
  });

  test('列3 プレビューで選んだ語をキーワードにする', async ({ signedIn: page }) => {
    await openChapter(page, { body: '植物は光合成を行う。' });

    await selectInPreview(page, '光合成');
    await page.getByRole('button', { name: 'キーワードを作成' }).click();

    await expect(page.getByLabel('正答')).toHaveValue('光合成');
  });

  test('列15 編集領域で選んだ語からも作れる', async ({ signedIn: page }) => {
    await openChapter(page, { body: '植物は光合成を行う。' });

    await selectInEditor(page, 3, 6);
    await page.getByRole('button', { name: 'キーワードを作成' }).click();

    await expect(page.getByLabel('正答')).toHaveValue('光合成');
    await page.getByLabel('タグ').fill('生物');
    await page.getByRole('button', { name: '確定' }).click();

    await expect(editor(page)).toHaveValue('植物は{{光合成|tags=生物}}を行う。');
  });

  test('列4 選択が無ければキーワードを作れない', async ({ signedIn: page }) => {
    await openChapter(page, { body: '植物は光合成を行う。' });
    await expect(page.getByRole('button', { name: 'キーワードを作成' })).toBeDisabled();
  });

  test('列6 空欄をクリックすると登録済みの内容が入る', async ({ signedIn: page }) => {
    await openChapter(page, {
      body: '植物は {{id=a3f9k2}} を行う。',
      keywords: [
        { docId: 'a3f9k2', answers: ['光合成', '炭酸同化'], tags: ['生物'], wrong: ['呼吸'] },
      ],
    });

    await preview(page).getByTestId('blank-a3f9k2').click();
    await expect(page.getByLabel('正答')).toHaveValue('光合成\n炭酸同化');
    await expect(page.getByLabel('タグ')).toHaveValue('生物');
    await expect(page.getByLabel('誤答選択肢')).toHaveValue('呼吸');
  });

  test('列9 ダイアログをキャンセルすると本文が変わらない', async ({ signedIn: page }) => {
    await openChapter(page, {
      body: '植物は {{id=a3f9k2}} を行う。',
      keywords: [{ docId: 'a3f9k2', answers: ['光合成'] }],
    });
    const before = await editor(page).inputValue();

    await preview(page).getByTestId('blank-a3f9k2').click();
    await page.getByLabel('正答').fill('別の答え');
    await page.getByRole('button', { name: 'キャンセル' }).click();

    await expect(editor(page)).toHaveValue(before);
  });

  test('列10 キーワードを解除すると素のテキストになる', async ({ signedIn: page }) => {
    await openChapter(page, {
      body: '植物は {{id=a3f9k2}} を行う。',
      keywords: [{ docId: 'a3f9k2', answers: ['光合成', '炭酸同化'] }],
    });

    await preview(page).getByTestId('blank-a3f9k2').click();
    await page.getByRole('button', { name: 'キーワードを解除' }).click();

    await expect(editor(page)).toHaveValue('植物は 光合成 を行う。');
    await expect(page.getByText('未保存の変更あり')).toBeVisible();
  });

  test('列12 編集領域で記述が色分けされる', async ({ signedIn: page }) => {
    await openChapter(page, { body: '植物は {{光合成}} を行う。' });
    await expect(page.getByTestId('editor-highlight').locator('.kw')).toHaveText('{{光合成}}');
  });

  test('列13 狭い画面では章・編集・プレビューをタブで切り替える', async ({ signedIn: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openChapter(page, { body: '植物は光合成を行う。' });

    await expect(page.getByRole('tab', { name: '編集' })).toBeVisible();
    await expect(preview(page)).toBeHidden();
    await page.getByRole('tab', { name: 'プレビュー' }).click();
    await expect(preview(page)).toBeVisible();
    await expect(editor(page)).toBeHidden();
  });
});

test.describe('保存と正規化', () => {
  /** 本文を1つ持つ章を開く。 */
  async function openChapter(
    page: Page,
    body: string,
    second = false,
    keywords: { docId: string; answers: string[] }[] = [],
  ) {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '生物');
    const db = adminClient();
    const material = await db
      .from('materials')
      .insert({ name: '細胞と代謝', subject_id: subjectId, owner_id: ownerId })
      .select('id')
      .single();
    if (material.error) throw material.error;
    const chapter = await db
      .from('chapters')
      .insert({
        material_id: material.data.id,
        owner_id: ownerId,
        title: '光合成',
        sort_order: 0,
        body,
      })
      .select('id')
      .single();
    if (chapter.error) throw chapter.error;
    if (second) {
      const { error } = await db.from('chapters').insert({
        material_id: material.data.id,
        owner_id: ownerId,
        title: '呼吸',
        sort_order: 1,
        body: '',
      });
      if (error) throw error;
    }
    for (const k of keywords) {
      const { error } = await db.from('keywords').insert({
        material_id: material.data.id,
        chapter_id: chapter.data.id,
        owner_id: ownerId,
        doc_id: k.docId,
        answers: k.answers,
      });
      if (error) throw error;
    }

    await page.goto(`/materials/${material.data.id}/edit`);
    await page.getByRole('treeitem', { name: '光合成' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    return {
      ownerId,
      materialId: material.data.id as string,
      chapterId: chapter.data.id as string,
    };
  }

  test('列1 保存すると本文が id のみになり、id が採番される', async ({ signedIn: page }) => {
    const { materialId, chapterId } = await openChapter(page, '');
    await page.getByLabel('本文').fill('植物は {{光合成,炭酸同化|tags=生物}} を行う。');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);

    const db = adminClient();
    const chapter = await db.from('chapters').select('body').eq('id', chapterId).single();
    expect(chapter.data?.body).toMatch(/^植物は \{\{id=[a-z0-9]{6}\}\} を行う。$/);

    const keywords = await db.from('keywords').select('*').eq('material_id', materialId);
    expect(keywords.data).toHaveLength(1);
    expect(keywords.data?.[0]?.answers).toEqual(['光合成', '炭酸同化']);
    expect(keywords.data?.[0]?.tags).toEqual(['生物']);
    expect(keywords.data?.[0]?.is_active).toBe(true);

    // 保存した本文は展開形式に戻して見せる
    await expect(page.getByLabel('本文')).toHaveValue(
      /^植物は \{\{光合成,炭酸同化\|id=[a-z0-9]{6}\|tags=生物\}\} を行う。$/,
    );
  });

  test('列3 本文から消したキーワードは出題対象から外れる', async ({ signedIn: page }) => {
    const { materialId } = await openChapter(page, '植物は {{id=a3f9k2}} を行う。', false, [
      { docId: 'a3f9k2', answers: ['光合成'] },
    ]);
    await page.getByLabel('本文').fill('植物は光合成を行う。');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);

    const db = adminClient();
    const keywords = await db
      .from('keywords')
      .select('doc_id, is_active')
      .eq('material_id', materialId);
    expect(keywords.data).toHaveLength(1);
    expect(keywords.data?.[0]?.is_active).toBe(false);
  });

  test('列4 消したキーワードを書き戻すと出題対象に戻る', async ({ signedIn: page }) => {
    const { materialId } = await openChapter(page, '植物は {{id=a3f9k2}} を行う。', false, [
      { docId: 'a3f9k2', answers: ['光合成'] },
    ]);
    const db = adminClient();

    await page.getByLabel('本文').fill('植物は光合成を行う。');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);

    await page.getByLabel('本文').fill('植物は {{id=a3f9k2}} を行う。');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);

    const keywords = await db
      .from('keywords')
      .select('doc_id, is_active')
      .eq('material_id', materialId);
    expect(keywords.data).toHaveLength(1);
    expect(keywords.data?.[0]?.is_active).toBe(true);
  });

  test('列6 開き直しても展開形式で復元される', async ({ signedIn: page }) => {
    await openChapter(page, '');
    await page.getByLabel('本文').fill('{{光合成|id=a3f9k2|tags=生物}} と {{id=a3f9k2}}');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);

    await page.reload();
    await page.getByRole('treeitem', { name: '光合成' }).click();
    await expect(page.getByLabel('本文')).toHaveValue(
      '{{光合成|id=a3f9k2|tags=生物}} と {{id=a3f9k2}}',
    );
  });

  test('列7 保存に失敗しても編集内容が消えない', async ({ signedIn: page }) => {
    await openChapter(page, '古い本文');
    await page.getByLabel('本文').fill('新しい本文');

    await page.route('**/rest/v1/chapters**', async (route) => {
      if (route.request().method() === 'PATCH') await route.abort('failed');
      else await route.continue();
    });
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('本文')).toHaveValue('新しい本文');
    await expect(page.getByText('未保存の変更あり')).toBeVisible();
  });

  test('列8 変更が無ければ保存を押せない', async ({ signedIn: page }) => {
    await openChapter(page, '本文');
    await expect(page.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  test('列9 空の本文も保存できる', async ({ signedIn: page }) => {
    const { chapterId } = await openChapter(page, '本文');
    await page.getByLabel('本文').fill('');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);

    const chapter = await adminClient()
      .from('chapters')
      .select('body')
      .eq('id', chapterId)
      .single();
    expect(chapter.data?.body).toBe('');
  });

  test('列10 未保存のまま別の章を選ぶと確認が出る', async ({ signedIn: page }) => {
    await openChapter(page, '本文', true);
    await page.getByLabel('本文').fill('書きかけ');

    await page.getByRole('treeitem', { name: '呼吸' }).click();
    await expect(page.getByRole('dialog')).toContainText('未保存');

    await page.getByRole('button', { name: '編集に戻る' }).click();
    await expect(page.getByLabel('本文')).toHaveValue('書きかけ');
  });

  test('列11 未保存のまま離れようとすると確認が出る', async ({ signedIn: page }) => {
    await openChapter(page, '本文');
    await page.getByLabel('本文').fill('書きかけ');

    const prevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
});

test.describe('保存時の上書き確認', () => {
  /** 教材・章・キーワードを1組用意して編集画面で章を開く。 */
  async function openWithKeyword(page: Page, body: string, answers = ['光合成']) {
    const ownerId = await ensureTestUser();
    const subjectId = await seedSubject(ownerId, '生物');
    const db = adminClient();
    const material = await db
      .from('materials')
      .insert({ name: '細胞と代謝', subject_id: subjectId, owner_id: ownerId })
      .select('id')
      .single();
    if (material.error) throw material.error;
    const chapter = await db
      .from('chapters')
      .insert({
        material_id: material.data.id,
        owner_id: ownerId,
        title: '光合成',
        sort_order: 0,
        body,
      })
      .select('id')
      .single();
    if (chapter.error) throw chapter.error;
    const keyword = await db
      .from('keywords')
      .insert({
        material_id: material.data.id,
        chapter_id: chapter.data.id,
        owner_id: ownerId,
        doc_id: 'a3f9k2',
        answers,
      })
      .select('id')
      .single();
    if (keyword.error) throw keyword.error;

    await page.goto(`/materials/${material.data.id}/edit`);
    await page.getByRole('treeitem', { name: '光合成' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    return { keywordId: keyword.data.id as string, chapterId: chapter.data.id as string };
  }

  test('列1 ダイアログで正答を変えても確認は出ない', async ({ signedIn: page }) => {
    const { keywordId } = await openWithKeyword(page, '植物は {{id=a3f9k2}} を行う。');

    await page.getByTestId('preview').getByTestId('blank-a3f9k2').click();
    await page.getByLabel('正答').fill('まったく別の語');
    await page.getByRole('button', { name: '確定' }).click();
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);
    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('id', keywordId)
      .single();
    expect(keyword.data?.answers).toEqual(['まったく別の語']);
  });

  test('列2 正答が1つ残る直しなら確認は出ない', async ({ signedIn: page }) => {
    const { keywordId } = await openWithKeyword(page, '植物は {{id=a3f9k2}} を行う。', [
      '光合成',
      '炭酸同化',
    ]);

    await page.getByLabel('本文').fill('植物は {{光合成,同化作用|id=a3f9k2}} を行う。');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);
    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('id', keywordId)
      .single();
    expect(keyword.data?.answers).toEqual(['光合成', '同化作用']);
  });

  test('列3・列4 一致しない内容を貼ると確認が出て、上書きを選べる', async ({ signedIn: page }) => {
    const { keywordId } = await openWithKeyword(page, '植物は {{id=a3f9k2}} を行う。');

    await page.getByLabel('本文').fill('細胞は {{呼吸|id=a3f9k2}} を行う。');
    await page.getByRole('button', { name: '保存' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('光合成');
    await expect(dialog).toContainText('呼吸');
    await dialog.getByRole('button', { name: '取り込んだ内容にする' }).click();
    await dialog.getByRole('button', { name: '適用' }).click();

    await expect(page.getByText('未保存の変更あり')).toHaveCount(0);
    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('id', keywordId)
      .single();
    expect(keyword.data?.answers).toEqual(['呼吸']);
  });

  test('列5 登録済みを残すと本文が DB の内容に戻る', async ({ signedIn: page }) => {
    const { keywordId } = await openWithKeyword(page, '植物は {{id=a3f9k2}} を行う。');

    await page.getByLabel('本文').fill('細胞は {{呼吸|id=a3f9k2}} を行う。');
    await page.getByRole('button', { name: '保存' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '登録済みを残す' }).click();
    await dialog.getByRole('button', { name: '適用' }).click();

    await expect(page.getByLabel('本文')).toHaveValue('細胞は {{光合成|id=a3f9k2}} を行う。');
    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('id', keywordId)
      .single();
    expect(keyword.data?.answers).toEqual(['光合成']);
  });

  test('列7 確認をキャンセルすると保存しない', async ({ signedIn: page }) => {
    const { keywordId, chapterId } = await openWithKeyword(page, '植物は {{id=a3f9k2}} を行う。');

    await page.getByLabel('本文').fill('細胞は {{呼吸|id=a3f9k2}} を行う。');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'やめる' }).click();

    await expect(page.getByText('未保存の変更あり')).toBeVisible();
    const db = adminClient();
    const keyword = await db.from('keywords').select('answers').eq('id', keywordId).single();
    expect(keyword.data?.answers).toEqual(['光合成']);
    const chapter = await db.from('chapters').select('body').eq('id', chapterId).single();
    expect(chapter.data?.body).toBe('植物は {{id=a3f9k2}} を行う。');
  });
});
