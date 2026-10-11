import { expect, test } from '@playwright/test';
import {
  adminClient,
  ensureTestUser,
  resetData,
  seedMaterialWithKeyword,
  seedSubject,
} from './db';
import { TEST_USER } from './env';

type VolumeModule = typeof import('./harness/structured-question-volume');

const PRIMARY_QUESTION_COUNT = 1_001;
const SECONDARY_QUESTION_COUNT = 2;
const SHARED_SORT_ORDER = 7;

function questionId(group: 1 | 2, index: number): string {
  return `${group}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

test.describe.serial('structured question volume conformance', () => {
  test.afterEach(async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
  });

  test('1,000行上限と同一sort_orderのページ境界を越えてkeyword・教材の全件を安定取得する', async ({ page }) => {
    test.setTimeout(60_000);
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '設問volume適合');
    const { materialId, chapterId, keywordId } = await seedMaterialWithKeyword(
      ownerId,
      subjectId,
      'qv0001',
    );
    const secondaryKeywordId = 'f0000000-0000-4000-8000-000000000001';
    const secondaryKeyword = await adminClient().from('keywords').insert({
      id: secondaryKeywordId,
      material_id: materialId,
      chapter_id: chapterId,
      owner_id: ownerId,
      doc_id: 'qv0002',
      answers: ['別キーワード'],
      tags: ['volume'],
    });
    expect(secondaryKeyword.error).toBeNull();

    const primaryIds = Array.from(
      { length: PRIMARY_QUESTION_COUNT },
      (_, index) => questionId(1, index),
    );
    const secondaryIds = Array.from(
      { length: SECONDARY_QUESTION_COUNT },
      (_, index) => questionId(2, index),
    );
    const groups = [
      { keywordId, ids: primaryIds },
      { keywordId: secondaryKeywordId, ids: secondaryIds },
    ];
    const expectedMaterialIds = [...groups]
      .sort((left, right) => left.keywordId < right.keywordId ? -1 : 1)
      .flatMap(({ ids }) => ids);
    const rows = groups.flatMap(({ keywordId: rowKeywordId, ids }) =>
      ids.map((id, index) => ({
        id,
        owner_id: ownerId,
        material_id: materialId,
        keyword_id: rowKeywordId,
        question_text: `volume設問${id}-${index}`,
        model_answer: `volume解答${id}-${index}`,
        choices: [],
        explanation: null,
        sort_order: SHARED_SORT_ORDER,
      })),
    );

    for (let from = 0; from < rows.length; from += 500) {
      const seeded = await adminClient().from('structured_questions').insert(rows.slice(from, from + 500));
      expect(seeded.error).toBeNull();
    }

    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();

    const result = await page.evaluate(async ({ keywordId, materialId }) => {
      const modulePath = '/e2e/harness/structured-question-volume.ts';
      const volume = await import(/* @vite-ignore */ modulePath) as VolumeModule;
      return volume.readQuestionVolume(keywordId, materialId);
    }, { keywordId, materialId });

    expect(result.keywordIds).toHaveLength(PRIMARY_QUESTION_COUNT);
    expect(new Set(result.keywordIds).size).toBe(PRIMARY_QUESTION_COUNT);
    expect(result.keywordIds).toEqual(primaryIds);
    expect(result.keywordIds.slice(998, 1001)).toEqual(primaryIds.slice(998, 1001));

    expect(result.materialIds).toHaveLength(PRIMARY_QUESTION_COUNT + SECONDARY_QUESTION_COUNT);
    expect(new Set(result.materialIds).size).toBe(PRIMARY_QUESTION_COUNT + SECONDARY_QUESTION_COUNT);
    expect(result.materialIds).toEqual(expectedMaterialIds);
    // 0-based index 999/1000 が、Supabase既定1,000行のページ境界をまたぐ。
    expect(result.materialIds.slice(998, 1002)).toEqual(expectedMaterialIds.slice(998, 1002));
  });
});
