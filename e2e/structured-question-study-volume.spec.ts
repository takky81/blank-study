import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { TEST_USER } from './env';

type VolumeModule = typeof import('./harness/question-study-volume');
type VolumeCandidates = import('./harness/question-study-volume').VolumeCandidate[];

/** KAの通常設問。1,004件挿入して3件を削除し、有効1,001件にする。 */
const KA_INSERTED = 1_004;
const KA_ACTIVE = 1_001;
const DUE_AT = '2026-01-01T00:00:00+00:00';
const KEYWORD_IDS = {
  b: 'b5000000-0000-4000-8000-000000000001',
  c: 'c5000000-0000-4000-8000-000000000001',
  inactive: 'd5000000-0000-4000-8000-000000000001',
  absent: 'e5000000-0000-4000-8000-000000000001',
} as const;
const CHAPTER2_ID = 'a5000000-0000-4000-8000-000000000002';

/** Postgresの md5(text)::uuid と同じ値をNode側で独立に作る。 */
function md5Uuid(text: string): string {
  const hex = createHash('md5').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-tA'],
    { encoding: 'utf8', input: sql },
  );
}

type Expected = { id: string; keywordId: string; sortOrder: number };

function byOrderThenId(left: Expected, right: Expected): number {
  return left.sortOrder - right.sortOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function keywordRow(id: string, materialId: string, chapterId: string, ownerId: string, docId: string, active: boolean) {
  return `('${id}', '${materialId}', '${chapterId}', '${ownerId}', '${docId}', array['${docId}'], array[]::text[], ${active})`;
}

function questionInsert(input: {
  prefix: string; count: number; ownerId: string; materialId: string; keywordId: string;
  sortOrder: string; active: boolean;
}): string {
  return `insert into public.structured_questions
      (id, owner_id, material_id, keyword_id, question_text, model_answer, sort_order, is_active)
    select md5('qsv-${input.prefix}-' || g)::uuid, '${input.ownerId}', '${input.materialId}', '${input.keywordId}',
      '設問' || g, '解答' || g, ${input.sortOrder}, ${input.active}
    from generate_series(1, ${input.count}) g;`;
}

function statsInsert(prefix: string, count: number, ownerId: string, asked: string, correct: string, where = 'true'): string {
  return `insert into public.structured_question_stats (question_id, owner_id, asked_count, correct_count, due_at)
    select md5('qsv-${prefix}-' || g)::uuid, '${ownerId}', ${asked}, ${correct}, '${DUE_AT}'
    from generate_series(1, ${count}) g where ${where};`;
}

test.describe.serial('QuestionStudyVolumeConformance', () => {
  test.afterEach(async () => {
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
  });

  test('1,001件超の範囲で科目・教材・章・keywordの候補とkeyword集計を欠落・重複なく安定取得する', async ({ page }) => {
    test.setTimeout(120_000);
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '設問学習volume適合');
    const { materialId, chapterId, keywordId: kaId } = await seedMaterialWithKeyword(
      ownerId, subjectId, 'qsva01',
    );
    const common = { ownerId, materialId };

    // 章1本文: B, A, I(無効keyword) / 章2本文: A, C, B。Nはどの本文にも出現しない。
    psql([
      'begin;',
      `update public.chapters set sort_order = 0,
         body = '{{B|id=qsvb01}} / {{A|id=qsva01}} / {{I|id=qsvi01}}' where id = '${chapterId}';`,
      `insert into public.chapters (id, material_id, owner_id, title, sort_order, body)
         values ('${CHAPTER2_ID}', '${materialId}', '${ownerId}', '応用', 1,
           '{{A|id=qsva01}} / {{C|id=qsvc01}} / {{B|id=qsvb01}}');`,
      `insert into public.keywords (id, material_id, chapter_id, owner_id, doc_id, answers, tags, is_active) values
         ${keywordRow(KEYWORD_IDS.b, materialId, chapterId, ownerId, 'qsvb01', true)},
         ${keywordRow(KEYWORD_IDS.c, materialId, CHAPTER2_ID, ownerId, 'qsvc01', true)},
         ${keywordRow(KEYWORD_IDS.inactive, materialId, chapterId, ownerId, 'qsvi01', false)},
         ${keywordRow(KEYWORD_IDS.absent, materialId, chapterId, ownerId, 'qsvn01', true)};`,
      // KA: 同じsort_order(g%3)が大量に続き、IDはmd5で順不同。
      questionInsert({ ...common, prefix: 'a', count: KA_INSERTED, keywordId: kaId, sortOrder: 'g % 3', active: true }),
      // KA無効設問（大きなstats付き。候補・集計から除外されること）
      questionInsert({ ...common, prefix: 'x', count: 5, keywordId: kaId, sortOrder: '0', active: false }),
      questionInsert({ ...common, prefix: 'b', count: 5, keywordId: KEYWORD_IDS.b, sortOrder: '0', active: true }),
      questionInsert({ ...common, prefix: 'c', count: 3, keywordId: KEYWORD_IDS.c, sortOrder: '0', active: true }),
      questionInsert({ ...common, prefix: 'i', count: 2, keywordId: KEYWORD_IDS.inactive, sortOrder: '0', active: true }),
      questionInsert({ ...common, prefix: 'n', count: 2, keywordId: KEYWORD_IDS.absent, sortOrder: '0', active: true }),
      // stats: 全行同一due_at。KAは g%100=0 がstatsなし、asked=g%4（0を含む）, correct=floor(asked/2)。
      statsInsert('a', KA_INSERTED, ownerId, 'g % 4', '(g % 4) / 2', 'g % 100 <> 0'),
      statsInsert('x', 5, ownerId, '50', '50'),
      statsInsert('b', 5, ownerId, '2', '1'),
      statsInsert('i', 2, ownerId, '1', '1'),
      // 削除設問（statsもcascadeで消える）
      `delete from public.structured_questions
         where id in (select md5('qsv-a-' || g)::uuid from generate_series(${KA_ACTIVE + 1}, ${KA_INSERTED}) g);`,
      'commit;',
    ].join('\n'));
    const statsCount = Number(psql(
      `select count(*) from public.structured_question_stats where owner_id = '${ownerId}' and due_at = '${DUE_AT}'`,
    ).trim());
    expect(statsCount).toBeGreaterThanOrEqual(1_001);

    // 期待値をNode側で独立に組み立てる。
    const group = (prefix: string, keywordId: string, count: number, sortOrder: (g: number) => number) =>
      Array.from({ length: count }, (_, i) => ({
        id: md5Uuid(`qsv-${prefix}-${i + 1}`), keywordId, sortOrder: sortOrder(i + 1),
      })).sort(byOrderThenId);
    const ka = group('a', kaId, KA_ACTIVE, (g) => g % 3);
    const kb = group('b', KEYWORD_IDS.b, 5, () => 0);
    const kc = group('c', KEYWORD_IDS.c, 3, () => 0);
    const excludedIds = new Set([
      ...[1002, 1003, 1004].map((g) => md5Uuid(`qsv-a-${g}`)),
      ...Array.from({ length: 5 }, (_, i) => md5Uuid(`qsv-x-${i + 1}`)),
      ...Array.from({ length: 2 }, (_, i) => md5Uuid(`qsv-i-${i + 1}`)),
      ...Array.from({ length: 2 }, (_, i) => md5Uuid(`qsv-n-${i + 1}`)),
    ]);
    // 教材・科目: 代表位置 B=(章1,0) < A=(章1,1) < C=(章2,1)
    const expectedMaterial = [...kb, ...ka, ...kc].map(({ id }) => id);
    // 章2: A=(章2,0) < C=(章2,1) < B=(章2,2)
    const expectedChapter2 = [...ka, ...kc, ...kb].map(({ id }) => id);
    // keyword直接: (sortOrder, id) のみ
    const expectedKeyword = ka.map(({ id }) => id);

    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();

    const scopes = [
      { kind: 'subject' as const, id: subjectId },
      { kind: 'material' as const, id: materialId },
      { kind: 'chapter' as const, id: CHAPTER2_ID },
      { kind: 'keyword' as const, id: kaId },
    ];
    const read = () => page.evaluate(async (args) => {
      const modulePath = '/e2e/harness/question-study-volume.ts';
      const volume = await import(/* @vite-ignore */ modulePath) as VolumeModule;
      return volume.readQuestionStudyVolume(args.scopes, args.materialId);
    }, { scopes, materialId });
    const first = await read();
    const second = await read();

    expect(first.candidates).toHaveLength(4);
    const [subject, material, chapter2, keyword] = first.candidates as [VolumeCandidates, VolumeCandidates, VolumeCandidates, VolumeCandidates];
    const expectations: [VolumeCandidates, string[]][] = [
      [subject, expectedMaterial],
      [material, expectedMaterial],
      [chapter2, expectedChapter2],
      [keyword, expectedKeyword],
    ];
    for (const [actual, expected] of expectations) {
      const ids = actual.map(({ id }) => id);
      expect(ids.length).toBeGreaterThan(1_000);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.some((id) => excludedIds.has(id))).toBe(false);
      expect(ids).toEqual(expected);
    }
    expect(second.candidates).toEqual(first.candidates);

    // 代表位置は最小tuple、keyword直接scopeは章位置を持たない。
    const firstOf = (list: VolumeCandidates, keywordId: string) => list.find((c) => c.keywordId === keywordId);
    expect(firstOf(material, kaId)).toMatchObject({ chapterOrder: 0, bodyOccurrenceIndex: 1 });
    expect(firstOf(material, KEYWORD_IDS.b)).toMatchObject({ chapterOrder: 0, bodyOccurrenceIndex: 0 });
    expect(firstOf(material, KEYWORD_IDS.c)).toMatchObject({ chapterOrder: 1, bodyOccurrenceIndex: 1 });
    expect(firstOf(chapter2, kaId)).toMatchObject({ chapterOrder: 1, bodyOccurrenceIndex: 0 });
    expect(firstOf(chapter2, KEYWORD_IDS.b)).toMatchObject({ chapterOrder: 1, bodyOccurrenceIndex: 2 });
    expect(keyword.every((c) => c.chapterOrder === null && c.bodyOccurrenceIndex === null)).toBe(true);

    // statsなしと同一due_at
    const withoutStats = new Set(material.filter((c) => !c.hasStats).map(({ id }) => id));
    expect(withoutStats).toEqual(new Set([
      ...Array.from({ length: 10 }, (_, i) => md5Uuid(`qsv-a-${(i + 1) * 100}`)),
      ...kc.map(({ id }) => id),
    ]));
    expect(material.filter((c) => c.hasStats).every((c) => Date.parse(c.dueAt ?? '') === Date.parse(DUE_AT)))
      .toBe(true);

    // keyword集計: 有効設問のみ、statsなし/attempts 0 は0扱い、比率は合計正解÷合計出題。
    let kaAttempts = 0;
    let kaCorrect = 0;
    for (let g = 1; g <= KA_ACTIVE; g += 1) {
      if (g % 100 === 0) continue;
      kaAttempts += g % 4;
      kaCorrect += Math.floor((g % 4) / 2);
    }
    const expectedAggregates = [
      { keywordId: kaId, attempts: kaAttempts, correct: kaCorrect, wrong: kaAttempts - kaCorrect,
        accuracy: kaCorrect / kaAttempts, questionCount: KA_ACTIVE },
      { keywordId: KEYWORD_IDS.b, attempts: 10, correct: 5, wrong: 5, accuracy: 0.5, questionCount: 5 },
      { keywordId: KEYWORD_IDS.c, attempts: 0, correct: 0, wrong: 0, accuracy: null, questionCount: 3 },
      { keywordId: KEYWORD_IDS.inactive, attempts: 2, correct: 2, wrong: 0, accuracy: 1, questionCount: 2 },
      { keywordId: KEYWORD_IDS.absent, attempts: 0, correct: 0, wrong: 0, accuracy: null, questionCount: 2 },
    ].sort((left, right) => (left.keywordId < right.keywordId ? -1 : 1));
    expect(first.aggregates).toEqual(expectedAggregates);
    expect(second.aggregates).toEqual(first.aggregates);
  });
});
