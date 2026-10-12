import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

import { parseExchangeExport } from '../src/features/questionExchange/schema';
import type {
  EligibilityReason,
  QuestionExchangeExportV1,
  QuestionExchangeTargetV1,
  RequestKind,
} from '../src/features/questionExchange/types';
import { ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { TEST_USER } from './env';

type VolumeModule = typeof import('./harness/question-exchange-volume');

/** keyword数。1,001件を超える対象を作るため余裕を持たせる。 */
const N = 1_250;
/** 末尾対象。全keyword中で最大のIDにし、flagと統計の両branchで対象にする。 */
const LAST_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CHAPTER2_ID = 'a6000000-0000-4000-8000-000000000002';
const CHAPTER3_ID = 'a6000000-0000-4000-8000-000000000003';
const FILTER = { minimumAttempts: 2, maximumAccuracy: 0.8, maximumQuestionCount: 3 };
const HEADER = { exchangeId: '3f2b8c1e-7d4a-4e9b-8a6c-1d2e3f4a5b6c', exportedAt: '2026-10-11T00:00:00.000Z' };

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

const keywordId = (g: number) => (g === N ? LAST_ID : md5Uuid(`qxv-k-${g}`));
const docId = (g: number) => `v${String(g).padStart(5, '0')}`;
const answersOf = (g: number) => (g % 2 === 0 ? [`語${g}`, `別${g}`] : [`語${g}`]);
const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

/** 章本文: 章1=奇数、章2(章1の子)=3の倍数、章3=5の倍数。複数章へ出現するkeywordを含む。 */
const inChapter1 = (g: number) => g % 2 === 1;
const inChapter2 = (g: number) => g % 3 === 0;
const inChapter3 = (g: number) => g % 5 === 0;
const body = (pick: (g: number) => boolean) =>
  range(N).filter(pick).map((g) => `{{語${g}|id=${docId(g)}}}`).join(' ');

/** 有効設問の規則。SQL式とNode式を同じ定義の中に並べ、goldenをseed定義から導く。 */
type QuestionRule = {
  kind: 'q1' | 'q2' | 'q3' | 'q4';
  where: [string, (g: number) => boolean];
  sortOrder: number;
  choices: string[];
  doubt: [string, (g: number) => boolean];
  explanationRequest: [string, (g: number) => boolean];
  /** [asked SQL, correct SQL, Node]。Nodeがnullなら統計行なし。 */
  stats: [string, string, (g: number) => { asked: number; correct: number } | null] | null;
};
const NO_STATS_SQL = 'g % 10 = 3';
const noStats = (g: number) => g % 10 === 3;
const RULES: QuestionRule[] = [
  {
    kind: 'q1', where: ['true', () => true], sortOrder: 1, choices: [],
    doubt: [`g % 4 = 0 or g % 8 = 1 or g = ${N}`, (g) => g % 4 === 0 || g % 8 === 1 || g === N],
    explanationRequest: [`g % 8 = 1 or g = ${N}`, (g) => g % 8 === 1 || g === N],
    stats: ['g % 5', '(g % 5) / 2', (g) => (noStats(g) ? null : { asked: g % 5, correct: Math.floor((g % 5) / 2) })],
  },
  {
    kind: 'q2', where: ['true', () => true], sortOrder: 1, choices: ['甲', '乙'],
    doubt: [`g = ${N}`, (g) => g === N],
    explanationRequest: [`g % 8 = 1 or g % 6 = 0 or g = ${N}`, (g) => g % 8 === 1 || g % 6 === 0 || g === N],
    stats: ['2', 'case when g % 3 = 0 then 2 else 1 end',
      (g) => (noStats(g) ? null : { asked: 2, correct: g % 3 === 0 ? 2 : 1 })],
  },
  {
    // attempts 0 の統計行を含む。解説付き。
    kind: 'q3', where: ['true', () => true], sortOrder: 0, choices: [],
    doubt: ['false', () => false], explanationRequest: ['false', () => false],
    stats: ['case when g % 9 = 0 then 0 else 1 end', 'case when g % 9 = 0 then 0 else 1 end',
      (g) => (noStats(g) ? null : { asked: g % 9 === 0 ? 0 : 1, correct: g % 9 === 0 ? 0 : 1 })],
  },
  {
    // 4件目の設問（統計なし）でquestionCount上限を超え、統計branchから外れるkeyword
    kind: 'q4', where: ['g % 13 = 0', (g) => g % 13 === 0], sortOrder: 2, choices: [],
    doubt: ['false', () => false], explanationRequest: ['false', () => false],
    stats: null,
  },
];
const explanationOf = (kind: QuestionRule['kind'], g: number) => (kind === 'q3' ? `解説${g}` : null);
const questionId = (kind: string, g: number) => md5Uuid(`qxv-${kind}-${g}`);
const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

function seedSql(ownerId: string, materialId: string, chapterId: string): string {
  const keywordIdSql = `case when g = ${N} then '${LAST_ID}'::uuid else md5('qxv-k-' || g)::uuid end`;
  const statements = [
    'begin;',
    `update public.chapters set sort_order = 0, parent_id = null, body = ${sqlText(body(inChapter1))}
       where id = '${chapterId}';`,
    `insert into public.chapters (id, material_id, owner_id, parent_id, title, sort_order, body) values
       ('${CHAPTER2_ID}', '${materialId}', '${ownerId}', '${chapterId}', '下位章', 0, ${sqlText(body(inChapter2))}),
       ('${CHAPTER3_ID}', '${materialId}', '${ownerId}', null, '応用', 1, ${sqlText(body(inChapter3))});`,
    `insert into public.keywords (id, material_id, chapter_id, owner_id, doc_id, answers, tags)
       select ${keywordIdSql}, '${materialId}', '${chapterId}', '${ownerId}', 'v' || lpad(g::text, 5, '0'),
         case when g % 2 = 0 then array['語' || g, '別' || g] else array['語' || g] end, array['用語']
       from generate_series(1, ${N}) g;`,
  ];
  for (const rule of RULES) {
    statements.push(`insert into public.structured_questions
        (id, owner_id, material_id, keyword_id, question_text, model_answer, choices, explanation, sort_order,
         doubt_flag, explanation_request_flag)
      select md5('qxv-${rule.kind}-' || g)::uuid, '${ownerId}', '${materialId}', ${keywordIdSql},
        '設問' || g || '-${rule.kind}', '解答' || g || '-${rule.kind}', ${sqlText(JSON.stringify(rule.choices))}::jsonb,
        ${rule.kind === 'q3' ? `'解説' || g` : 'null'}, ${rule.sortOrder}, (${rule.doubt[0]}), (${rule.explanationRequest[0]})
      from generate_series(1, ${N}) g where ${rule.where[0]};`);
    if (rule.stats !== null) {
      statements.push(`insert into public.structured_question_stats (question_id, owner_id, asked_count, correct_count)
        select md5('qxv-${rule.kind}-' || g)::uuid, '${ownerId}', ${rule.stats[0]}, ${rule.stats[1]}
        from generate_series(1, ${N}) g where not (${NO_STATS_SQL}) and ${rule.where[0]};`);
    }
  }
  statements.push(
    // 無効設問: flagと誤答の多い統計を持つが、理由・metrics・questionsへ混入しない
    `insert into public.structured_questions
        (id, owner_id, material_id, keyword_id, question_text, model_answer, sort_order, is_active,
         doubt_flag, explanation_request_flag)
      select md5('qxv-x-' || g)::uuid, '${ownerId}', '${materialId}', ${keywordIdSql}, '無効' || g, '無効', 0, false, true, true
      from generate_series(1, ${N}) g where g % 7 = 0;`,
    `insert into public.structured_question_stats (question_id, owner_id, asked_count, correct_count)
      select md5('qxv-x-' || g)::uuid, '${ownerId}', 100, 0 from generate_series(1, ${N}) g where g % 7 = 0;`,
    // 削除設問: flagと統計付きで作成後に削除する
    `insert into public.structured_questions (id, owner_id, material_id, keyword_id, question_text, model_answer, doubt_flag)
      select md5('qxv-d-' || g)::uuid, '${ownerId}', '${materialId}', ${keywordIdSql}, '削除' || g, '削除', true
      from generate_series(1, ${N}) g where g % 11 = 0;`,
    `insert into public.structured_question_stats (question_id, owner_id, asked_count, correct_count)
      select md5('qxv-d-' || g)::uuid, '${ownerId}', 100, 0 from generate_series(1, ${N}) g where g % 11 = 0;`,
    `delete from public.structured_questions
      where id in (select md5('qxv-d-' || g)::uuid from generate_series(1, ${N}) g where g % 11 = 0);`,
    // 穴埋め履歴: 全keywordに誤答だらけの統計とlogを置く（設問交換の評価には混ぜない）
    `insert into public.keyword_stats (keyword_id, owner_id, total_count, correct_count)
      select ${keywordIdSql}, '${ownerId}', 40, 0 from generate_series(1, ${N}) g;`,
    `insert into public.answer_logs (keyword_id, owner_id, format, input, is_correct)
      select ${keywordIdSql}, '${ownerId}', 'text', '誤答', false from generate_series(1, ${N}) g;`,
    'commit;',
  );
  return statements.join('\n');
}

const REASON_ORDER: EligibilityReason[] = ['doubt-flag', 'explanation-request-flag', 'performance-and-count'];
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** seed定義からschema v1 exportの期待値（golden）をNode側で独立に組み立てる。 */
function goldenExport(input: { subjectId: string; materialId: string; chapterId: string }): QuestionExchangeExportV1 {
  const subject = { id: input.subjectId, title: '設問交換volume適合', sortOrder: 0 };
  const material = { id: input.materialId, title: 'テクノロジ系', sortOrder: 0 };
  // 章木のpre-order: 章1(0) → 章2(1, 章1の子) → 章3(2)
  const chapters = [
    { id: input.chapterId, title: '基礎理論', sortOrder: 0, bodyMarkdown: body(inChapter1), has: inChapter1 },
    { id: CHAPTER2_ID, title: '下位章', sortOrder: 1, bodyMarkdown: body(inChapter2), has: inChapter2 },
    { id: CHAPTER3_ID, title: '応用', sortOrder: 2, bodyMarkdown: body(inChapter3), has: inChapter3 },
  ];
  const targets: QuestionExchangeTargetV1[] = [];
  for (const g of range(N)) {
    const rules = RULES.filter((r) => r.where[1](g));
    let attempts = 0;
    let correct = 0;
    for (const rule of rules) {
      const stats = rule.stats?.[2](g) ?? null;
      attempts += stats?.asked ?? 0;
      correct += stats?.correct ?? 0;
    }
    const questionCount = rules.length;
    const accuracy = attempts > 0 ? correct / attempts : null;
    const performance = attempts > 0 && attempts - correct >= 1 && attempts >= FILTER.minimumAttempts
      && (accuracy as number) <= FILTER.maximumAccuracy && questionCount <= FILTER.maximumQuestionCount;
    const flagged = rules.map((rule) => {
      const kinds: RequestKind[] = [];
      if (rule.doubt[1](g)) kinds.push('doubt');
      if (rule.explanationRequest[1](g)) kinds.push('explanation-request');
      return { questionId: questionId(rule.kind, g), requestKinds: kinds };
    }).filter((f) => f.requestKinds.length > 0).sort((a, b) => cmp(a.questionId, b.questionId));
    const reasons = REASON_ORDER.filter((reason) =>
      reason === 'doubt-flag' ? flagged.some((f) => f.requestKinds.includes('doubt'))
        : reason === 'explanation-request-flag' ? flagged.some((f) => f.requestKinds.includes('explanation-request'))
          : performance);
    if (reasons.length === 0) continue;
    const kindsById = new Map(flagged.map((f) => [f.questionId, f.requestKinds]));
    const answers = answersOf(g);
    targets.push({
      keyword: { id: keywordId(g), displayText: answers[0]!, modelAnswer: answers.join('、') },
      metrics: { attempts, correct, wrong: attempts - correct, accuracy, questionCount },
      reasons,
      chapterContexts: chapters.filter((c) => c.has(g)).map(({ id, title, sortOrder, bodyMarkdown }) => ({
        subject, material, chapter: { id, title, sortOrder, bodyMarkdown },
      })),
      questions: rules.map((rule) => ({
        questionId: questionId(rule.kind, g),
        expectedVersion: 1,
        sortOrder: rule.sortOrder,
        questionText: `設問${g}-${rule.kind}`,
        modelAnswer: `解答${g}-${rule.kind}`,
        choices: rule.choices,
        explanation: explanationOf(rule.kind, g),
        doubtNote: null,
        requestedFlags: kindsById.get(questionId(rule.kind, g)) ?? [],
      })).sort((a, b) => a.sortOrder - b.sortOrder || cmp(a.questionId, b.questionId)),
      flaggedQuestions: flagged,
    });
  }
  targets.sort((a, b) => cmp(a.keyword.id, b.keyword.id));
  return { schemaVersion: 1, ...HEADER, filters: FILTER, targets };
}

test.describe.serial('QuestionExchangeVolumeConformance', () => {
  test.afterEach(async () => {
    await resetData(await ensureTestUser());
  });

  test('1,001件超のeligibility exportがschema v1の安定順・理由・metrics・章文脈・設問でgoldenと完全一致する', async ({ page }) => {
    test.setTimeout(180_000);
    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '設問交換volume適合');
    const { materialId, chapterId } = await seedMaterialWithKeyword(ownerId, subjectId, 'qxv000');
    psql(seedSql(ownerId, materialId, chapterId));

    // seed規模の前提: 1,001件超のkeyword・有効設問・統計と、穴埋め履歴の存在
    const counts = psql(`select
        (select count(*) from public.keywords where owner_id = '${ownerId}'),
        (select count(*) from public.structured_questions where owner_id = '${ownerId}' and is_active),
        (select count(*) from public.structured_question_stats where owner_id = '${ownerId}'),
        (select count(*) from public.keyword_stats where owner_id = '${ownerId}'),
        (select count(*) from public.answer_logs where owner_id = '${ownerId}')`).trim().split('|').map(Number);
    expect(counts).toHaveLength(5);
    for (const count of counts) expect(count).toBeGreaterThan(1_001);

    const expected = goldenExport({ subjectId, materialId, chapterId });
    // golden自体が検証対象の分岐を網羅していること
    const targets = expected.targets;
    expect(targets.length).toBeGreaterThan(1_001);
    expect(targets.length).toBeLessThan(N);
    const has = (reasons: EligibilityReason[]) => targets.some((t) =>
      t.reasons.length === reasons.length && reasons.every((r) => t.reasons.includes(r)));
    expect(has(['doubt-flag'])).toBe(true);
    expect(has(['explanation-request-flag'])).toBe(true);
    expect(has(['performance-and-count'])).toBe(true);
    expect(has(['doubt-flag', 'explanation-request-flag', 'performance-and-count'])).toBe(true);
    expect(targets.some((t) => t.flaggedQuestions.length >= 2
      && t.flaggedQuestions.some((f) => f.requestKinds.length === 2)
      && t.flaggedQuestions.some((f) => f.requestKinds.length === 1)
      && t.reasons.includes('performance-and-count'))).toBe(true);
    expect(targets.some((t) => t.metrics.attempts === 0 && t.metrics.accuracy === null)).toBe(true);
    expect(targets.some((t) => t.metrics.questionCount === 4)).toBe(true);
    expect(targets.some((t) => t.chapterContexts.length >= 2)).toBe(true);
    expect(targets.some((t) => t.chapterContexts.length === 0)).toBe(true);
    expect(targets.at(-1)!.keyword.id).toBe(LAST_ID);
    expect(targets.at(-1)!.reasons).toEqual(REASON_ORDER);

    await page.goto('/');
    await page.getByLabel('メールアドレス').fill(TEST_USER.email);
    await page.getByLabel('パスワード').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('heading', { name: '科目' })).toBeVisible();

    const run = () => page.evaluate(async (args) => {
      const modulePath = '/e2e/harness/question-exchange-volume.ts';
      const volume = await import(/* @vite-ignore */ modulePath) as VolumeModule;
      return volume.runEligibilityExport(args.filter, args.header);
    }, { filter: FILTER, header: HEADER });
    const first = await run();
    const second = await run();

    expect(first.result.kind).toBe('export');
    if (first.result.kind !== 'export' || first.serialized === null) throw new Error('export結果ではありません');
    const actual = first.result.value;

    // 件数・欠落・重複
    const ids = actual.targets.map((t) => t.keyword.id);
    expect(ids).toHaveLength(targets.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(targets.map((t) => t.keyword.id));
    const questionIds = actual.targets.flatMap((t) => t.questions.map((q) => q.questionId));
    expect(new Set(questionIds).size).toBe(questionIds.length);
    // 無効・削除設問は混入しない
    const excluded = new Set(range(N).flatMap((g) => [
      ...(g % 7 === 0 ? [questionId('x', g)] : []),
      ...(g % 11 === 0 ? [questionId('d', g)] : []),
    ]));
    expect(questionIds.some((id) => excluded.has(id))).toBe(false);
    expect(actual.targets.flatMap((t) => t.flaggedQuestions).some((f) => excluded.has(f.questionId))).toBe(false);

    // 全体をgoldenと比較（順序・理由・metrics・章文脈・設問・flaggedQuestions、穴埋め履歴非混入）
    expect(actual).toEqual(expected);

    // schema v1 codecでも妥当で、同一値へ復元できる
    const parsed = parseExchangeExport(first.serialized);
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    if (parsed.ok) expect(parsed.value).toEqual(expected);

    // 再実行でも同じ安定順
    expect(second).toEqual(first);
  });
});
