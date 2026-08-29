import { test, expect, type Page } from './fixtures';
import { ensureTestUser, seedSubject, adminClient } from './db';

/** 決定表「学習履歴の集計」 spec/tables/19-history.jsonl */

/** 科目・教材・章・キーワードと、その学習状態を用意する。 */
async function seedHistory(
  keywords: { docId: string; answers: string[]; total: number; correct: number }[],
) {
  const ownerId = await ensureTestUser();
  const subjectId = await seedSubject(ownerId, '基本情報技術者');
  const db = adminClient();

  const material = await db
    .from('materials')
    .insert({ name: 'テクノロジ系', subject_id: subjectId, owner_id: ownerId })
    .select('id')
    .single();
  if (material.error) throw material.error;

  const body = keywords.map((k) => `{{id=${k.docId}}}`).join(' と ');
  const chapter = await db
    .from('chapters')
    .insert({
      material_id: material.data.id,
      owner_id: ownerId,
      title: '基礎理論',
      body,
      sort_order: 0,
    })
    .select('id')
    .single();
  if (chapter.error) throw chapter.error;

  for (const keyword of keywords) {
    const row = await db
      .from('keywords')
      .insert({
        material_id: material.data.id,
        chapter_id: chapter.data.id,
        owner_id: ownerId,
        doc_id: keyword.docId,
        answers: keyword.answers,
      })
      .select('id')
      .single();
    if (row.error) throw row.error;

    if (keyword.total > 0) {
      const stats = await db.from('keyword_stats').insert({
        keyword_id: row.data.id,
        owner_id: ownerId,
        total_count: keyword.total,
        correct_count: keyword.correct,
        repetition: 1,
        ease_factor: 2.5,
        interval_days: 1,
        due_at: new Date().toISOString(),
        last_answered_at: new Date().toISOString(),
      });
      if (stats.error) throw stats.error;

      for (let i = 0; i < keyword.total; i += 1) {
        const log = await db.from('answer_logs').insert({
          keyword_id: row.data.id,
          owner_id: ownerId,
          format: 'text',
          input: keyword.answers[0],
          is_correct: i < keyword.correct,
        });
        if (log.error) throw log.error;
      }
    }
  }

  return { ownerId, subjectId, materialId: material.data.id as string };
}

const open = async (page: Page) => {
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: '学習履歴' })).toBeVisible();
};

test.describe('学習履歴', () => {
  test('列5 章ごとの達成度と数値が出る', async ({ signedIn: page }) => {
    await seedHistory([
      { docId: 'aaaaaa', answers: ['光合成'], total: 10, correct: 10 },
      { docId: 'bbbbbb', answers: ['呼吸'], total: 4, correct: 1 },
      { docId: 'cccccc', answers: ['CPU'], total: 0, correct: 0 },
    ]);
    await open(page);

    await page.getByRole('button', { name: /テクノロジ系/ }).click();
    const chapter = page.getByTestId('history-row-基礎理論');
    await expect(chapter).toContainText('3 問');
    await expect(chapter).toContainText('定着 1');
    await expect(chapter).toContainText('苦手 1');
    await expect(chapter).toContainText('未出題 1');
    await expect(chapter).toContainText('79%');
  });

  test('列17 階層を開閉できる', async ({ signedIn: page }) => {
    await seedHistory([{ docId: 'aaaaaa', answers: ['光合成'], total: 1, correct: 1 }]);
    await open(page);

    await expect(page.getByTestId('history-row-基礎理論')).toHaveCount(0);
    await page.getByRole('button', { name: /テクノロジ系/ }).click();
    await expect(page.getByTestId('history-row-基礎理論')).toBeVisible();
    await page.getByRole('button', { name: /テクノロジ系/ }).click();
    await expect(page.getByTestId('history-row-基礎理論')).toHaveCount(0);
  });

  test('列13 苦手キーワードが正答率の低い順に並ぶ', async ({ signedIn: page }) => {
    await seedHistory([
      { docId: 'aaaaaa', answers: ['光合成'], total: 4, correct: 3 },
      { docId: 'bbbbbb', answers: ['呼吸'], total: 4, correct: 1 },
      { docId: 'cccccc', answers: ['CPU'], total: 0, correct: 0 },
    ]);
    await open(page);

    const items = page.getByTestId('weak-keyword');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('呼吸');
    await expect(items.nth(1)).toContainText('光合成');
  });

  test('列15 日別の学習量が出る', async ({ signedIn: page }) => {
    await seedHistory([{ docId: 'aaaaaa', answers: ['光合成'], total: 3, correct: 2 }]);
    await open(page);

    const today = page.getByTestId('daily-volume').getByTestId('daily-cell').last();
    await expect(today).toHaveAttribute('data-count', '3');
  });

  test('列18 解答履歴が無ければその旨を出す', async ({ signedIn: page }) => {
    await seedHistory([{ docId: 'aaaaaa', answers: ['光合成'], total: 0, correct: 0 }]);
    await open(page);

    await expect(page.getByText('まだ解答の記録がありません')).toBeVisible();
    await expect(page.getByTestId('daily-volume')).toHaveCount(0);
  });
});
