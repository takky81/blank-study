import { test, expect, type Page } from './fixtures';
import { ensureTestUser, seedSubject, adminClient } from './db';

/**
 * 決定表「出題順」「解答形式の決定」「選択肢の生成」
 * 「表示範囲内のキーワードの表示」「正誤判定」「別解の登録」「SRS の更新」
 */
type SeedKeyword = {
  docId: string;
  answers: string[];
  tags?: string[];
  wrong?: string[];
  stats?: { totalCount: number; correctCount: number; dueAt?: string };
};

type SeedChapter = {
  title: string;
  body: string;
  parent?: string;
  keywords?: SeedKeyword[];
};

/** 教材を1つ作り、章とキーワードを用意する。 */
async function seedMaterial(chapters: SeedChapter[]) {
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

  const idOf = new Map<string, string>();
  let order = 0;
  for (const chapter of chapters) {
    const inserted = await db
      .from('chapters')
      .insert({
        material_id: materialId,
        parent_id: chapter.parent ? idOf.get(chapter.parent) : null,
        owner_id: ownerId,
        title: chapter.title,
        body: chapter.body,
        sort_order: order++,
      })
      .select('id')
      .single();
    if (inserted.error) throw inserted.error;
    idOf.set(chapter.title, inserted.data.id as string);

    for (const keyword of chapter.keywords ?? []) {
      const row = await db
        .from('keywords')
        .insert({
          material_id: materialId,
          chapter_id: inserted.data.id,
          owner_id: ownerId,
          doc_id: keyword.docId,
          answers: keyword.answers,
          tags: keyword.tags ?? [],
          wrong_choices: keyword.wrong ?? [],
        })
        .select('id')
        .single();
      if (row.error) throw row.error;

      if (keyword.stats) {
        const { error } = await db.from('keyword_stats').insert({
          keyword_id: row.data.id,
          owner_id: ownerId,
          total_count: keyword.stats.totalCount,
          correct_count: keyword.stats.correctCount,
          repetition: 1,
          ease_factor: 2.5,
          interval_days: 1,
          due_at: keyword.stats.dueAt ?? new Date().toISOString(),
          last_answered_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
    }
  }

  return { ownerId, subjectId, materialId, chapterIds: idOf };
}

/** 出題設定画面を開いてそのまま開始する。 */
async function start(page: Page, materialId: string, options: { order?: '自動' | '出現順' } = {}) {
  await page.goto(`/materials/${materialId}/study`);
  if (options.order) await page.getByRole('radio', { name: options.order, exact: true }).check();
  await page.getByRole('button', { name: '開始する' }).click();
}

const body = (page: Page) => page.getByTestId('study-body');

test.describe('出題', () => {
  test('出題順 列11 対象が無ければ開始できない', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([{ title: '光合成', body: 'キーワードのない本文' }]);

    await page.goto(`/materials/${materialId}/study`);
    await expect(page.getByText('出題できるキーワードがありません')).toBeVisible();
    await expect(page.getByRole('button', { name: '開始する' })).toBeDisabled();
  });

  test('出題順 列8 選んだ章のキーワードだけが出る', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
      {
        title: '呼吸',
        body: '細胞は {{id=bbbbbb}} を行う。',
        keywords: [{ docId: 'bbbbbb', answers: ['呼吸'] }],
      },
    ]);

    await page.goto(`/materials/${materialId}/study`);
    await page.getByRole('checkbox', { name: '呼吸' }).uncheck();
    await page.getByRole('button', { name: '開始する' }).click();

    await expect(body(page)).toContainText('植物は');
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();
    await page.getByRole('button', { name: '次の問題へ' }).click();
    await expect(page.getByText('おつかれさまでした')).toBeVisible();
  });

  test('表示 列1・列2 出題中は空欄、同じタグの語は伏せる', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '{{id=aaaaaa}} と {{id=bbbbbb}} と {{id=cccccc}}',
        keywords: [
          { docId: 'aaaaaa', answers: ['光合成'], tags: ['生物'] },
          { docId: 'bbbbbb', answers: ['呼吸'], tags: ['生物'] },
          { docId: 'cccccc', answers: ['CPU'], tags: ['情報'] },
        ],
      },
    ]);

    await page.goto(`/materials/${materialId}/study`);
    await page.getByRole('radio', { name: '出現順', exact: true }).check();
    await page.getByRole('radio', { name: '記述', exact: true }).check();
    await page.getByRole('button', { name: '開始する' }).click();

    await expect(page.getByLabel('解答')).toBeVisible();
    await expect(body(page)).not.toContainText('光合成');
    await expect(body(page)).not.toContainText('呼吸');
    await expect(body(page)).toContainText('〈生物〉');
    await expect(body(page)).toContainText('CPU');
  });

  test('判定 列1・表示 列4 正しく答えると正解になり正答が出る', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    await page.getByLabel('解答').fill(' ｺｳｺﾞｳｾｲ ');
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByText('不正解')).toBeVisible();

    await page.getByRole('button', { name: '次の問題へ' }).click();
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByText('正解', { exact: true })).toBeVisible();
    await expect(body(page)).toContainText('光合成');
  });

  test('判定 列8 空の入力では解答できない', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    await expect(page.getByRole('button', { name: '解答する' })).toBeDisabled();
    await page.getByLabel('解答').fill('   ');
    await expect(page.getByRole('button', { name: '解答する' })).toBeDisabled();
  });

  test('表示 列5・列6 誤答した語の入る位置を示し、伏せ字を戻す', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '{{id=aaaaaa}} と {{id=bbbbbb}}',
        keywords: [
          { docId: 'aaaaaa', answers: ['光合成'], tags: ['生物'] },
          { docId: 'bbbbbb', answers: ['呼吸'], tags: ['生物'] },
        ],
      },
    ]);

    await page.goto(`/materials/${materialId}/study`);
    await page.getByRole('radio', { name: '出現順', exact: true }).check();
    await page.getByRole('radio', { name: '記述', exact: true }).check();
    await page.getByRole('button', { name: '開始する' }).click();
    await page.getByLabel('解答').fill('呼吸');
    await page.getByRole('button', { name: '解答する' }).click();

    await expect(page.getByText('不正解')).toBeVisible();
    await expect(page.getByTestId('blank-bbbbbb')).toHaveAttribute('data-color', 'orange');
    await expect(page.getByTestId('blank-aaaaaa')).toHaveAttribute('data-color', 'yellow');
    await expect(body(page)).toContainText('呼吸');
  });

  test('判定 列7・選択肢 列12 選択肢で答える', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [
          { docId: 'aaaaaa', answers: ['光合成'], tags: ['生物'], wrong: ['呼吸', '蒸散', '発酵'] },
        ],
      },
    ]);

    await page.goto(`/materials/${materialId}/study`);
    await page.getByRole('radio', { name: '選択肢', exact: true }).check();
    await page.getByRole('button', { name: '開始する' }).click();

    await expect(page.getByRole('radio', { name: '光合成' })).toBeVisible();
    await expect(page.getByLabel('解答')).toHaveCount(0);
    await page.getByRole('radio', { name: '光合成' }).check();
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByText('正解', { exact: true })).toBeVisible();
  });

  test('別解 列1・列6 登録すると正解に変わり、次回から通る', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    await page.getByLabel('解答').fill('炭酸同化');
    await page.getByRole('button', { name: '解答する' }).click();
    await page.getByRole('button', { name: '別解として登録する' }).click();

    await expect(page.getByText('正解', { exact: true })).toBeVisible();

    const db = adminClient();
    const keyword = await db.from('keywords').select('answers').eq('doc_id', 'aaaaaa').single();
    expect(keyword.data?.answers).toEqual(['光合成', '炭酸同化']);
    const log = await db.from('answer_logs').select('is_correct').single();
    expect(log.data?.is_correct).toBe(true);

    // 次に出題されたときも通る（列7）
    await start(page, materialId);
    await page.getByLabel('解答').fill('炭酸同化');
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByText('正解', { exact: true })).toBeVisible();
  });

  test('別解 列2・列3 正解のときは導線を出さず、登録せずに進める', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '{{id=aaaaaa}} と {{id=bbbbbb}}',
        keywords: [
          { docId: 'aaaaaa', answers: ['光合成'] },
          { docId: 'bbbbbb', answers: ['呼吸'] },
        ],
      },
    ]);

    await start(page, materialId, { order: '出現順' });
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();
    await expect(page.getByRole('button', { name: '別解として登録する' })).toHaveCount(0);

    await page.getByRole('button', { name: '次の問題へ' }).click();
    await page.getByLabel('解答').fill('別の語');
    await page.getByRole('button', { name: '解答する' }).click();
    await page.getByRole('button', { name: '次の問題へ' }).click();

    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('doc_id', 'aaaaaa')
      .single();
    expect(keyword.data?.answers).toEqual(['光合成']);
  });

  test('別解 列9 登録に失敗しても判定は覆らない', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    await page.getByLabel('解答').fill('炭酸同化');
    await page.getByRole('button', { name: '解答する' }).click();

    await page.route('**/rest/v1/keywords**', async (route) => {
      if (route.request().method() === 'PATCH') await route.abort('failed');
      else await route.continue();
    });
    await page.getByRole('button', { name: '別解として登録する' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('不正解')).toBeVisible();
    const keyword = await adminClient()
      .from('keywords')
      .select('answers')
      .eq('doc_id', 'aaaaaa')
      .single();
    expect(keyword.data?.answers).toEqual(['光合成']);
  });

  test('表示 列9・列14 表示範囲を広げても答えは見えない', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      { title: '生物', body: '上位の章の本文 {{id=cccccc}}', keywords: [] },
      {
        title: '光合成',
        parent: '生物',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [
          { docId: 'aaaaaa', answers: ['光合成'], tags: ['生物'] },
          { docId: 'cccccc', answers: ['呼吸'], tags: ['生物'] },
        ],
      },
    ]);

    await page.goto(`/materials/${materialId}/study`);
    await page.getByRole('radio', { name: '記述', exact: true }).check();
    // 上位の章は出題範囲から外す。表示範囲としては広げられる
    await page.getByRole('checkbox', { name: '生物', exact: true }).uncheck();
    await page.getByRole('button', { name: '開始する' }).click();
    await expect(body(page)).not.toContainText('上位の章の本文');

    await page.getByRole('button', { name: '表示範囲を広げる' }).click();
    await expect(body(page)).toContainText('上位の章の本文');
    // 広げた先にも伏せ字を掛け直す
    await expect(body(page)).not.toContainText('呼吸');
    await expect(body(page)).toContainText('〈生物〉');
  });

  test('SRS 列4・出題順 列12 間違えた問題は残り、正解で一周が終わる', async ({
    signedIn: page,
  }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    await page.getByLabel('解答').fill('違う');
    await page.getByRole('button', { name: '解答する' }).click();
    await page.getByRole('button', { name: '次の問題へ' }).click();

    // 1問しかないので同じ問題が戻ってくる（連続回避は候補が少ないと緩む）
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();
    await page.getByRole('button', { name: '次の問題へ' }).click();

    await expect(page.getByText('おつかれさまでした')).toBeVisible();
    await expect(page.getByText('正答 1 / 2')).toBeVisible();

    await expect
      .poll(async () => {
        const stats = await adminClient()
          .from('keyword_stats')
          .select('total_count, correct_count');
        return stats.data?.[0];
      })
      .toEqual({ total_count: 2, correct_count: 1 });
  });

  test('出題順 列13 中断してもそこまでの記録が残る', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '{{id=aaaaaa}} と {{id=bbbbbb}}',
        keywords: [
          { docId: 'aaaaaa', answers: ['光合成'] },
          { docId: 'bbbbbb', answers: ['呼吸'] },
        ],
      },
    ]);

    await start(page, materialId, { order: '出現順' });
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();
    await page.getByRole('button', { name: '中断する' }).click();

    await expect(page).toHaveURL(/\/subjects\//);
    await expect
      .poll(async () => (await adminClient().from('answer_logs').select('is_correct')).data?.length)
      .toBe(1);
  });

  test('判定 列16 記録に失敗しても解答は続けられる', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    await page.route('**/rest/v1/answer_logs**', (route) => route.abort('failed'));
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();

    await expect(page.getByText('正解', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('記録');
  });

  test('判定 列17 判定のあとにその問題の成績を出す', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    // 初めての出題なので、今回の解答だけで数える（列18）
    await page.getByLabel('解答').fill('違う');
    await page.getByRole('button', { name: '解答する' }).click();

    const score = page.getByTestId('keyword-score');
    await expect(score).toContainText('正答 0 / 出題 1');
    await expect(score).toContainText('0%');

    // 2回目。前回の分を含めて数える（列17）
    await page.getByRole('button', { name: '次の問題へ' }).click();
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();

    await expect(score).toContainText('正答 1 / 出題 2');
    await expect(score).toContainText('50%');
  });

  test('判定 列19 記録できなかったときは成績を出さない', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
    ]);

    await start(page, materialId);
    await page.route('**/rest/v1/answer_logs**', (route) => route.abort('failed'));
    await page.getByLabel('解答').fill('光合成');
    await page.getByRole('button', { name: '解答する' }).click();

    await expect(page.getByText('正解', { exact: true })).toBeVisible();
    await expect(page.getByTestId('keyword-score')).toHaveCount(0);
  });

  test('表示 列17 表のセルの空欄が崩れない', async ({ signedIn: page }) => {
    // フル形式の記述はセルの中に | を持つ。表の区切りと取り違えると列がずれる
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: [
          '| 語 | 説明 |',
          '| --- | --- |',
          '| {{光合成|id=aaaaaa|tags=生物}} | 葉緑体で行う |',
        ].join('\n'),
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'], tags: ['生物'] }],
      },
    ]);

    await start(page, materialId);
    const row = body(page).locator('tbody tr').first();
    await expect(row.locator('td')).toHaveCount(2);
    await expect(row.locator('td').nth(1)).toContainText('葉緑体で行う');
    await expect(page.getByLabel('解答')).toBeVisible();
  });

  test('表示 列16 表を含む本文が崩れずに出る', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '記号',
        body: '| 記号 | 意味 |\n| --- | --- |\n| A | {{id=aaaaaa}} |',
        keywords: [{ docId: 'aaaaaa', answers: ['論理積'] }],
      },
    ]);

    await start(page, materialId);
    await expect(body(page).locator('table')).toBeVisible();
    await expect(body(page).locator('th').first()).toContainText('記号');
    await expect(page.getByLabel('解答')).toBeVisible();
  });

  test('解答形式 列1 定着した問題は記述で出る', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [
          {
            docId: 'aaaaaa',
            answers: ['光合成'],
            wrong: ['呼吸', '蒸散', '発酵'],
            stats: { totalCount: 3, correctCount: 3 },
          },
        ],
      },
    ]);

    await start(page, materialId);
    await expect(page.getByLabel('解答')).toBeVisible();
  });

  test('解答形式 列10 未出題は選択肢で出る', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'], wrong: ['呼吸', '蒸散', '発酵'] }],
      },
    ]);

    await start(page, materialId);
    await expect(page.getByRole('radio', { name: '光合成' })).toBeVisible();
  });
});

test.describe('章の管理が出題に効く', () => {
  test('章の管理 列11 削除した章のキーワードは出題されない', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
      {
        title: '呼吸',
        body: '細胞は {{id=bbbbbb}} を行う。',
        keywords: [{ docId: 'bbbbbb', answers: ['呼吸'] }],
      },
    ]);

    await page.goto(`/materials/${materialId}/edit`);
    await page.getByRole('treeitem', { name: '光合成' }).click();
    await expect(page.getByLabel('本文')).toBeVisible();
    await page.getByRole('button', { name: '章を削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();
    await expect(page.getByRole('treeitem', { name: '光合成' })).toHaveCount(0);

    await start(page, materialId, { order: '出現順' });
    await expect(body(page)).toContainText('細胞は');
    await page.getByLabel('解答').fill('呼吸');
    await page.getByRole('button', { name: '解答する' }).click();
    await page.getByRole('button', { name: '次の問題へ' }).click();
    // 消した章のキーワードは候補に残らないので、ここで一周が終わる
    await expect(page.getByText('おつかれさまでした')).toBeVisible();
  });

  test('章の管理 列12 章の並び順を変えると出現順の出題も変わる', async ({ signedIn: page }) => {
    const { materialId } = await seedMaterial([
      {
        title: '光合成',
        body: '植物は {{id=aaaaaa}} を行う。',
        keywords: [{ docId: 'aaaaaa', answers: ['光合成'] }],
      },
      {
        title: '呼吸',
        body: '細胞は {{id=bbbbbb}} を行う。',
        keywords: [{ docId: 'bbbbbb', answers: ['呼吸'] }],
      },
    ]);

    await start(page, materialId, { order: '出現順' });
    await expect(body(page)).toContainText('植物は');

    await page.goto(`/materials/${materialId}/edit`);
    const second = page.getByRole('treeitem', { name: '呼吸' });
    await second.dispatchEvent('dragstart');
    const gap = page.getByTestId('chapter-gap-root-0');
    await gap.dispatchEvent('dragover');
    await gap.dispatchEvent('drop');
    await expect(page.getByRole('treeitem').nth(0)).toContainText('呼吸');

    await start(page, materialId, { order: '出現順' });
    await expect(body(page)).toContainText('細胞は');
  });
});
