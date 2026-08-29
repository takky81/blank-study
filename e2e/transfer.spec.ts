import { test, expect, type Page } from './fixtures';
import { ensureTestUser, seedSubject, adminClient } from './db';
import { encodeZip, decodeZip } from '../src/features/transfer/archive';

/**
 * 決定表「インポートの単位」「インポート時のキーワード突合」 spec/tables/10-import.jsonl
 * 決定表「エクスポート」 spec/tables/11-export.jsonl
 */

/** zip を作ってファイル選択に渡せる形にする。 */
function zipFile(name: string, files: Record<string, string>) {
  return {
    name,
    mimeType: 'application/zip',
    buffer: Buffer.from(encodeZip(files)),
  };
}

/** 科目だけを用意する。 */
async function seedOnlySubject(page: Page) {
  const ownerId = await ensureTestUser();
  const subjectId = await seedSubject(ownerId, '基本情報技術者');
  await page.goto(`/subjects/${subjectId}`);
  return { ownerId, subjectId };
}

/** 教材と章を用意する。 */
async function seedMaterial(ownerId: string, subjectId: string, name = 'テクノロジ系') {
  const db = adminClient();
  const material = await db
    .from('materials')
    .insert({ name, subject_id: subjectId, owner_id: ownerId })
    .select('id')
    .single();
  if (material.error) throw material.error;
  const chapter = await db
    .from('chapters')
    .insert({
      material_id: material.data.id,
      owner_id: ownerId,
      title: '基礎理論',
      sort_order: 0,
      body: '植物は {{id=a3f9k2}} を行う。',
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
      answers: ['光合成'],
      tags: ['生物'],
    })
    .select('id')
    .single();
  if (keyword.error) throw keyword.error;
  return {
    materialId: material.data.id as string,
    chapterId: chapter.data.id as string,
    keywordId: keyword.data.id as string,
  };
}

test.describe('インポート', () => {
  test('列1 zip を教材として取り込む', async ({ signedIn: page }) => {
    const { subjectId } = await seedOnlySubject(page);

    await page.getByTestId('import-material').setInputFiles(
      zipFile('テクノロジ系.zip', {
        '010_基礎理論/index.md': '# 基礎理論',
        '010_基礎理論/010_2進数.md': '{{ビット|tags=用語}} は最小単位。',
        '020_アルゴリズム.md': '整列の話。',
      }),
    );

    await expect(page.getByText('テクノロジ系', { exact: true })).toBeVisible();

    const db = adminClient();
    const materials = await db.from('materials').select('id, name').eq('subject_id', subjectId);
    expect(materials.data).toHaveLength(1);
    expect(materials.data?.[0]?.name).toBe('テクノロジ系');

    const chapters = await db
      .from('chapters')
      .select('title, parent_id, sort_order, body')
      .eq('material_id', materials.data?.[0]?.id)
      .order('sort_order');
    expect(chapters.data?.map((c) => c.title)).toEqual(['基礎理論', '2進数', 'アルゴリズム']);

    const keywords = await db.from('keywords').select('doc_id, answers, tags');
    expect(keywords.data).toHaveLength(1);
    expect(keywords.data?.[0]?.answers).toEqual(['ビット']);
    // 列8: 保存する本文は id のみに縮約する
    const child = chapters.data?.find((c) => c.title === '2進数');
    expect(child?.body).toMatch(/^\{\{id=[a-z0-9]{6}\}\} は最小単位。$/);
  });

  test('列2 章だけを既存の教材に取り込む', async ({ signedIn: page }) => {
    const { ownerId, subjectId } = await seedOnlySubject(page);
    const { materialId } = await seedMaterial(ownerId, subjectId);

    await page.goto(`/materials/${materialId}/edit`);
    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    await page.getByTestId('import-chapter').setInputFiles(
      zipFile('追加分.zip', { '010_論理演算.md': '論理演算の本文' }),
    );

    await expect(page.getByRole('treeitem', { name: '論理演算' })).toHaveAttribute(
      'aria-level',
      '2',
    );

    const chapters = await adminClient()
      .from('chapters')
      .select('title')
      .eq('material_id', materialId);
    expect(chapters.data?.map((c) => c.title).sort()).toEqual(['基礎理論', '論理演算']);
  });

  test('突合列3・列10 正答が重なるキーワードは確認なしで更新される', async ({
    signedIn: page,
  }) => {
    const { ownerId, subjectId } = await seedOnlySubject(page);
    const { materialId, keywordId } = await seedMaterial(ownerId, subjectId);

    await page.goto(`/materials/${materialId}/edit`);
    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    await page.getByTestId('import-chapter').setInputFiles(
      zipFile('追加分.zip', {
        '010_光合成.md': '{{光合成,炭酸同化|id=a3f9k2|tags=生物,理科}} の話。',
      }),
    );

    await expect(page.getByRole('treeitem', { name: '光合成' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const keyword = await adminClient()
      .from('keywords')
      .select('id, answers, tags')
      .eq('id', keywordId)
      .single();
    // 同じ行を更新するので解答履歴と SRS の状態は続く
    expect(keyword.data?.answers).toEqual(['光合成', '炭酸同化']);
    expect(keyword.data?.tags).toEqual(['生物', '理科']);
  });

  test('突合列4・列6 正答が食い違うと確認が出て、上書きを選べる', async ({ signedIn: page }) => {
    const { ownerId, subjectId } = await seedOnlySubject(page);
    const { materialId, keywordId } = await seedMaterial(ownerId, subjectId);

    await page.goto(`/materials/${materialId}/edit`);
    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    await page.getByTestId('import-chapter').setInputFiles(
      zipFile('追加分.zip', { '010_呼吸.md': '{{呼吸|id=a3f9k2}} の話。' }),
    );

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('光合成');
    await expect(dialog).toContainText('呼吸');

    await dialog.getByRole('button', { name: '取り込んだ内容にする' }).click();
    await dialog.getByRole('button', { name: '適用' }).click();

    await expect(page.getByRole('treeitem', { name: '呼吸' })).toBeVisible();
    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('id', keywordId)
      .single();
    expect(keyword.data?.answers).toEqual(['呼吸']);
  });

  test('突合列7 確認で登録済みを残せる', async ({ signedIn: page }) => {
    const { ownerId, subjectId } = await seedOnlySubject(page);
    const { materialId, keywordId } = await seedMaterial(ownerId, subjectId);

    await page.goto(`/materials/${materialId}/edit`);
    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    await page.getByTestId('import-chapter').setInputFiles(
      zipFile('追加分.zip', { '010_呼吸.md': '{{呼吸|id=a3f9k2}} の話。' }),
    );

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '登録済みを残す' }).click();
    await dialog.getByRole('button', { name: '適用' }).click();

    await expect(page.getByRole('treeitem', { name: '呼吸' })).toBeVisible();
    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('id', keywordId)
      .single();
    expect(keyword.data?.answers).toEqual(['光合成']);
  });

  test('突合列9 途中で失敗したら何も取り込まれない', async ({ signedIn: page }) => {
    const { subjectId } = await seedOnlySubject(page);

    await page.route('**/rest/v1/rpc/import_material', (route) => route.abort('failed'));
    await page.getByTestId('import-material').setInputFiles(
      zipFile('テクノロジ系.zip', { '010_基礎理論.md': '{{ビット}} の話。' }),
    );

    await expect(page.getByRole('alert')).toBeVisible();

    const db = adminClient();
    expect((await db.from('materials').select('id').eq('subject_id', subjectId)).data).toHaveLength(
      0,
    );
    expect((await db.from('chapters').select('id')).data).toHaveLength(0);
    expect((await db.from('keywords').select('id')).data).toHaveLength(0);
  });

  test('列5 壊れた zip は読み込めない旨を出す', async ({ signedIn: page }) => {
    await seedOnlySubject(page);

    await page.getByTestId('import-material').setInputFiles({
      name: 'こわれた.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from([1, 2, 3, 4]),
    });

    await expect(page.getByRole('alert')).toContainText('読み込めません');
  });

  test('列6 .md が無い zip は取り込める章がない旨を出す', async ({ signedIn: page }) => {
    await seedOnlySubject(page);

    await page
      .getByTestId('import-material')
      .setInputFiles(zipFile('メモ.zip', { 'readme.txt': 'ただのメモ' }));

    await expect(page.getByRole('alert')).toContainText('取り込める章がありません');
  });
});

test.describe('エクスポート', () => {
  test('列1 教材を zip に書き出す', async ({ signedIn: page }) => {
    const { ownerId, subjectId } = await seedOnlySubject(page);
    await seedMaterial(ownerId, subjectId);
    await page.reload();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '書き出す' }).click(),
    ]).then(([d]) => d);

    expect(download.suggestedFilename()).toBe('テクノロジ系.zip');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const files = decodeZip(new Uint8Array(Buffer.concat(chunks)));

    expect(Object.keys(files)).toEqual(['010_基礎理論.md']);
    // 章の最初の1か所はフル形式に展開する
    expect(files['010_基礎理論.md']).toBe('植物は {{光合成|id=a3f9k2|tags=生物}} を行う。');
  });

  test('列5 書き出して同じ教材に取り込んでも内容が変わらない', async ({ signedIn: page }) => {
    const { ownerId, subjectId } = await seedOnlySubject(page);
    const { materialId, keywordId } = await seedMaterial(ownerId, subjectId);
    await page.reload();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '書き出す' }).click(),
    ]).then(([d]) => d);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    await page.goto(`/materials/${materialId}/edit`);
    await page.getByRole('treeitem', { name: '基礎理論' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    await page.getByTestId('import-chapter').setInputFiles({
      name: 'テクノロジ系.zip',
      mimeType: 'application/zip',
      buffer,
    });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    const keyword = await adminClient()
      .from('keywords')
      .select('answers, tags')
      .eq('id', keywordId)
      .single();
    expect(keyword.data?.answers).toEqual(['光合成']);
    expect(keyword.data?.tags).toEqual(['生物']);
  });
});
