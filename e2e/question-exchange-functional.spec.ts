import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { parseExchangeExport } from '../src/features/questionExchange/schema';
import type {
  ImportOperation,
  QuestionExchangeExportV1,
  QuestionExchangeImportV1,
  QuestionExchangeTargetV1,
} from '../src/features/questionExchange/types';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject, setChapterBody } from './db';
import { signIn } from './fixtures';

/**
 * filter入力 → JSON download → 外部AI編集の模擬（Node内） → upload → preview → 取消 の手動交換経路。
 * app-shell登録前のため本番routeを認証済みsessionのharnessで描画し、本番API・ローカルSupabaseで検証する。
 */
test.describe.configure({ mode: 'serial' });

const UNKNOWN_KEYWORD = 'e7000000-0000-4000-8000-000000000001';
/** vite / ローカルSupabaseに加え、index.htmlが読む静的webfont配信だけを許可する（交換処理の通信ではない）。 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com']);

type Seed = {
  subjectId: string;
  materialId: string;
  chapterId: string;
  flagKeywordId: string;
  statsKeywordId: string;
  flaggedQuestion: { id: string; version: number };
  plainQuestion: { id: string; version: number };
  statsQuestion: { id: string; version: number };
};

async function insertQuestion(row: Record<string, unknown>) {
  const { data, error } = await adminClient().from('structured_questions').insert({
    choices: [], explanation: null, ...row,
  }).select('id, version').single();
  if (error) throw error;
  return data as { id: string; version: number };
}

/**
 * keyword A: 疑義flag設問 + flagなし設問（統計なし）。
 * keyword B: 統計branchで該当（4回中1回正答）。keyword C: 全問正答で非該当。
 */
async function seed(ownerId: string): Promise<Seed> {
  const db = adminClient();
  const subjectId = await seedSubject(ownerId, '交換機能');
  const { materialId, chapterId, keywordId: flagKeywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xq0001');
  const extra = await db.from('keywords').insert([
    { material_id: materialId, chapter_id: chapterId, owner_id: ownerId, doc_id: 'xq0002', answers: ['バイト', 'オクテット'], tags: ['単位'] },
    { material_id: materialId, chapter_id: chapterId, owner_id: ownerId, doc_id: 'xq0003', answers: ['ワード'], tags: ['単位'] },
  ]).select('id, doc_id');
  if (extra.error) throw extra.error;
  const statsKeywordId = extra.data.find((k) => k.doc_id === 'xq0002')!.id as string;
  const correctKeywordId = extra.data.find((k) => k.doc_id === 'xq0003')!.id as string;
  await setChapterBody(chapterId, ['xq0001', 'xq0002', 'xq0003']);

  const base = { owner_id: ownerId, material_id: materialId };
  const flaggedQuestion = await insertQuestion({
    ...base, keyword_id: flagKeywordId, question_text: '1バイトは何ビットか', model_answer: '8ビット',
    choices: ['4ビット', '16ビット'], explanation: '1バイトは8ビット。', sort_order: 0, doubt_flag: true,
    doubt_note: '16ビットとする資料もあるのでは', doubt_reasons: ['weak_distractors', 'defective'],
  });
  const plainQuestion = await insertQuestion({
    ...base, keyword_id: flagKeywordId, question_text: 'ビットの語源は', model_answer: 'binary digit', sort_order: 1,
  });
  const statsQuestion = await insertQuestion({
    ...base, keyword_id: statsKeywordId, question_text: 'オクテットは何ビットか', model_answer: '8ビット', sort_order: 0,
  });
  const correctQuestion = await insertQuestion({
    ...base, keyword_id: correctKeywordId, question_text: 'ワード長の例は', model_answer: '32ビット', sort_order: 0,
  });
  const stats = await db.from('structured_question_stats').insert([
    { question_id: statsQuestion.id, owner_id: ownerId, asked_count: 4, correct_count: 1 },
    { question_id: correctQuestion.id, owner_id: ownerId, asked_count: 4, correct_count: 4 },
  ]);
  if (stats.error) throw stats.error;
  return { subjectId, materialId, chapterId, flagKeywordId, statsKeywordId, flaggedQuestion, plainQuestion, statsQuestion };
}

const BODY = '{{id=xq0001}} の説明。\n\n{{id=xq0002}} の説明。\n\n{{id=xq0003}} の説明。';

/** seedから固定的に組み立てる期待artifact（exchangeId/exportedAtは正規化して比較する）。 */
function golden(s: Seed, filters: QuestionExchangeExportV1['filters'], includeStats: boolean): QuestionExchangeExportV1 {
  const chapterContexts = [{
    subject: { id: s.subjectId, title: '交換機能', sortOrder: 0 },
    material: { id: s.materialId, title: 'テクノロジ系', sortOrder: 0 },
    chapter: { id: s.chapterId, title: '基礎理論', sortOrder: 0, bodyMarkdown: BODY },
  }];
  const flagTarget: QuestionExchangeTargetV1 = {
    keyword: { id: s.flagKeywordId, displayText: 'ビット', modelAnswer: 'ビット' },
    metrics: { attempts: 0, correct: 0, wrong: 0, accuracy: null, questionCount: 2 },
    reasons: ['doubt-flag'],
    chapterContexts,
    questions: [
      {
        questionId: s.flaggedQuestion.id, expectedVersion: s.flaggedQuestion.version, sortOrder: 0,
        questionText: '1バイトは何ビットか', modelAnswer: '8ビット', choices: ['4ビット', '16ビット'],
        explanation: '1バイトは8ビット。', doubtNote: '16ビットとする資料もあるのでは', doubtReasons: ['defective', 'weak_distractors'], requestedFlags: ['doubt'],
      },
      {
        questionId: s.plainQuestion.id, expectedVersion: s.plainQuestion.version, sortOrder: 1,
        questionText: 'ビットの語源は', modelAnswer: 'binary digit', choices: [], explanation: null, doubtNote: null, doubtReasons: [], requestedFlags: [],
      },
    ],
    flaggedQuestions: [{ questionId: s.flaggedQuestion.id, requestKinds: ['doubt'] }],
  };
  const statsTarget: QuestionExchangeTargetV1 = {
    keyword: { id: s.statsKeywordId, displayText: 'バイト', modelAnswer: 'バイト、オクテット' },
    metrics: { attempts: 4, correct: 1, wrong: 3, accuracy: 0.25, questionCount: 1 },
    reasons: ['performance-and-count'],
    chapterContexts,
    questions: [{
      questionId: s.statsQuestion.id, expectedVersion: s.statsQuestion.version, sortOrder: 0,
      questionText: 'オクテットは何ビットか', modelAnswer: '8ビット', choices: [], explanation: null, doubtNote: null, doubtReasons: [], requestedFlags: [],
    }],
    flaggedQuestions: [],
  };
  const targets = includeStats ? [flagTarget, statsTarget] : [flagTarget];
  return {
    schemaVersion: 1, exchangeId: 'EXCHANGE_ID', exportedAt: 'EXPORTED_AT', filters,
    targets: [...targets].sort((a, b) => (a.keyword.id < b.keyword.id ? -1 : a.keyword.id > b.keyword.id ? 1 : 0)),
  };
}

async function dbSnapshot(ownerId: string) {
  const db = adminClient();
  const questions = await db.from('structured_questions').select('*').eq('owner_id', ownerId).order('id');
  const keywords = await db.from('keywords').select('*').eq('owner_id', ownerId).order('id');
  const stats = await db.from('structured_question_stats').select('*').eq('owner_id', ownerId).order('question_id');
  if (questions.error) throw questions.error;
  if (keywords.error) throw keywords.error;
  if (stats.error) throw stats.error;
  return { questions: questions.data, keywords: keywords.data, stats: stats.data };
}

async function fillFilter(page: Page, values: { attempts: string; accuracy: string; count: string }) {
  await page.getByLabel('最低出題回数').fill(values.attempts);
  await page.getByLabel('最大正答率').fill(values.accuracy);
  await page.getByLabel('最大設問数').fill(values.count);
}

async function exportAndRead(page: Page, values: { attempts: string; accuracy: string; count: string }) {
  await fillFilter(page, values);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '対象を出力' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^question-exchange-\d{8}T\d{6}Z\.json$/);
  await expect(page.getByRole('status')).toContainText(`${download.suggestedFilename()} を出力しました。`);
  const parsed = parseExchangeExport(new Uint8Array(readFileSync(await download.path())));
  if (!parsed.ok) throw new Error(`export artifactがschema v1に適合しません: ${JSON.stringify(parsed.errors)}`);
  return parsed.value;
}

function normalize(value: QuestionExchangeExportV1): QuestionExchangeExportV1 {
  return { ...value, exchangeId: 'EXCHANGE_ID', exportedAt: 'EXPORTED_AT' };
}

async function upload(page: Page, body: string | object) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  await page.getByLabel('返却ファイル（JSON）').setInputFiles({
    name: 'return.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8'),
  });
  await page.getByRole('button', { name: 'previewを作成' }).click();
  const region = page.getByRole('region', { name: '取込preview' });
  await expect(region).toBeVisible();
  return region;
}

function importFile(operations: readonly unknown[]): QuestionExchangeImportV1 {
  return {
    schemaVersion: 1, exchangeId: 'e7000000-0000-4000-8000-0000000000ff', exportedAt: '2026-10-11T00:00:00Z',
    operations: operations as ImportOperation[],
  };
}

test.describe('QuestionExchangeFunctionalE2E', () => {
  let ownerId = '';
  let s: Seed;
  let externalRequests: string[] = [];

  test.beforeEach(async ({ page }) => {
    ownerId = await ensureTestUser();
    await resetData(ownerId);
    s = await seed(ownerId);
    externalRequests = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['blob:', 'data:'].includes(url.protocol) && !ALLOWED_HOSTS.has(url.hostname)) externalRequests.push(request.url());
    });
    await signIn(page);
    await page.goto('/e2e/harness/question-exchange.html');
    await expect(page.getByRole('heading', { name: '設問交換', level: 1 })).toBeVisible();
  });

  test.afterEach(async () => {
    // 外部AIへの通信は発生せず、requestはlocalhost（vite / ローカルSupabase）と静的font配信だけである。
    expect(externalRequests).toEqual([]);
    await resetData(ownerId);
  });

  test('flag単独branchのexportがgoldenと一致し、外部編集したcreate/updateをpreviewして取消すと何も書き込まない', async ({ page }) => {
    const filters = { minimumAttempts: 100, maximumAccuracy: 0, maximumQuestionCount: 0 };
    const exported = await exportAndRead(page, { attempts: '100', accuracy: '0', count: '0' });
    expect(normalize(exported)).toEqual(golden(s, filters, false));
    expect(exported.exchangeId).toMatch(/^[0-9a-f-]{36}$/);

    // 外部AIの編集を模擬: exportの設問からupdateを、同keywordへcreateを作る。
    const target = exported.targets[0]!;
    const flagged = target.questions.find((q) => q.requestedFlags.length > 0)!;
    const returned = importFile([
      { kind: 'create', keywordId: target.keyword.id, question: { questionText: '8ビットをまとめた単位は', modelAnswer: 'バイト', choices: ['ワード'], explanation: '8ビット=1バイト。' } },
      {
        kind: 'update', keywordId: target.keyword.id, questionId: flagged.questionId, expectedVersion: flagged.expectedVersion,
        question: { questionText: '1バイトは何ビットで構成されるか', modelAnswer: '8ビット', choices: ['4ビット'], explanation: '現在の一般的な定義。' },
        sourceRequestedFlags: flagged.requestedFlags, resolvedFlags: ['doubt'],
      },
    ]);

    const before = await dbSnapshot(ownerId);
    const region = await upload(page, returned);
    await expect(region.getByText('新規 1件')).toBeVisible();
    await expect(region.getByText('更新 1件')).toBeVisible();
    await expect(region.getByText('競合 0件')).toBeVisible();
    await expect(region.getByText('エラー 0件')).toBeVisible();
    await expect(region.getByText('8ビットをまとめた単位は')).toBeVisible();
    await expect(region.getByText(`設問 ${flagged.questionId}（版 ${flagged.expectedVersion}）`)).toBeVisible();
    await expect(region.getByText('1バイトは何ビットか', { exact: true })).toBeVisible();
    await expect(region.getByText('1バイトは何ビットで構成されるか')).toBeVisible();
    await expect(region.getByRole('button', { name: '取込を確定' })).toBeEnabled();

    await region.getByRole('button', { name: '取消' }).click();
    await expect(region).toBeHidden();
    expect(await dbSnapshot(ownerId)).toEqual(before);
  });

  test('統計AND群を含むexportがgoldenと一致し、両keywordへの編集を新規/更新としてpreviewできる', async ({ page }) => {
    const filters = { minimumAttempts: 1, maximumAccuracy: 0.5, maximumQuestionCount: 10 };
    const exported = await exportAndRead(page, { attempts: '1', accuracy: '0.5', count: '10' });
    expect(normalize(exported)).toEqual(golden(s, filters, true));

    const statsTarget = exported.targets.find((t) => t.reasons.includes('performance-and-count'))!;
    const q = statsTarget.questions[0]!;
    const before = await dbSnapshot(ownerId);
    const region = await upload(page, importFile([
      { kind: 'create', keywordId: statsTarget.keyword.id, question: { questionText: '1オクテットは何バイトか', modelAnswer: '1バイト', choices: ['2バイト'], explanation: null } },
      { kind: 'create', keywordId: statsTarget.keyword.id, question: { questionText: 'オクテットの用途は', modelAnswer: '通信分野', choices: [], explanation: null } },
      {
        kind: 'update', keywordId: statsTarget.keyword.id, questionId: q.questionId, expectedVersion: q.expectedVersion,
        question: { questionText: 'オクテットは何ビットで構成されるか', modelAnswer: '8ビット', choices: ['7ビット'], explanation: '解説を追加。' },
        sourceRequestedFlags: [], resolvedFlags: [],
      },
    ]));
    await expect(region.getByText('新規 2件')).toBeVisible();
    await expect(region.getByText('更新 1件')).toBeVisible();
    await expect(region.getByText('オクテットは何ビットで構成されるか')).toBeVisible();
    await expect(region.getByRole('button', { name: '取込を確定' })).toBeEnabled();
    await region.getByRole('button', { name: '取消' }).click();
    await expect(region).toBeHidden();
    expect(await dbSnapshot(ownerId)).toEqual(before);
  });

  test('対象0件ではdownloadせず空結果を表示する', async ({ page }) => {
    expect((await adminClient().from('structured_questions').update({ doubt_flag: false, doubt_note: null, doubt_reasons: [] }).eq('id', s.flaggedQuestion.id)).error).toBeNull();
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    await fillFilter(page, { attempts: '100', accuracy: '0', count: '0' });
    await page.getByRole('button', { name: '対象を出力' }).click();
    await expect(page.getByRole('status')).toContainText('条件に該当する対象はありません。ファイルは出力していません。');
    expect(downloads).toBe(0);
  });

  test('不正なfilter入力はfield別errorを表示し、抽出もdownloadも行わない', async ({ page }) => {
    let downloads = 0;
    let rpcCalls = 0;
    page.on('download', () => { downloads += 1; });
    page.on('request', (r) => { if (r.url().includes('get_question_exchange_candidates')) rpcCalls += 1; });

    await page.getByRole('button', { name: '対象を出力' }).click();
    await expect(page.getByText('最低出題回数を数値で入力してください。')).toBeVisible();
    await expect(page.getByText('最大正答率を数値で入力してください。')).toBeVisible();
    await expect(page.getByText('最大設問数を数値で入力してください。')).toBeVisible();
    await expect(page.getByLabel('最低出題回数')).toBeFocused();

    await fillFilter(page, { attempts: '1.5', accuracy: '1.5', count: '-1' });
    await page.getByRole('button', { name: '対象を出力' }).click();
    await expect(page.getByText('最低出題回数は0以上の整数で入力してください。')).toBeVisible();
    await expect(page.getByText('最大正答率は0以上1以下で入力してください。')).toBeVisible();
    await expect(page.getByText('最大設問数は0以上の整数で入力してください。')).toBeVisible();
    await expect(page.getByLabel('最大正答率')).toHaveAttribute('aria-invalid', 'true');
    expect(downloads).toBe(0);
    expect(rpcCalls).toBe(0);
  });

  const invalidCases: { name: string; body: (s: Seed) => string | object; message: string | RegExp }[] = [
    { name: 'invalid JSON', body: () => '{"schemaVersion": 1, operations: [', message: '$: JSONとして解析できません。' },
    {
      name: 'invalid schema（未対応schemaVersionと未定義項目）',
      body: () => ({ ...importFile([]), schemaVersion: 2, extra: true }),
      message: '$.extra: schema v1で定義されていない項目です。',
    },
    {
      name: '設問IDの重複',
      body: (seed) => importFile([0, 1].map(() => ({
        kind: 'update', keywordId: seed.flagKeywordId, questionId: seed.plainQuestion.id, expectedVersion: seed.plainQuestion.version,
        question: { questionText: '改', modelAnswer: 'binary digit', choices: [], explanation: null }, sourceRequestedFlags: [], resolvedFlags: [],
      }))),
      message: /設問ID .* が重複しています（operations\[0\]と重複）。/,
    },
    {
      name: 'unknown参照',
      body: () => importFile([{ kind: 'create', keywordId: UNKNOWN_KEYWORD, question: { questionText: '問', modelAnswer: '答', choices: [], explanation: null } }]),
      message: `keyword ID ${UNKNOWN_KEYWORD} は存在しません。`,
    },
    {
      name: '模範解答と重複する不正選択肢',
      body: (seed) => importFile([{ kind: 'create', keywordId: seed.flagKeywordId, question: { questionText: '問', modelAnswer: '8ビット', choices: ['8ビット'], explanation: null } }]),
      message: '選択肢1は模範解答と重複しています。',
    },
    {
      name: 'delete命令',
      body: (seed) => importFile([{ kind: 'delete', keywordId: seed.flagKeywordId, questionId: seed.plainQuestion.id }]),
      message: '$.operations[0].kind: 削除命令には対応していません。',
    },
    {
      name: 'export時にrequestedでないflagを含むsourceRequestedFlags改変',
      body: (seed) => importFile([{
        kind: 'update', keywordId: seed.flagKeywordId, questionId: seed.plainQuestion.id, expectedVersion: seed.plainQuestion.version,
        question: { questionText: 'ビットの語源は何か', modelAnswer: 'binary digit', choices: [], explanation: null },
        sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt'],
      }]),
      message: /フラグ doubt は現在立っていないため解除できません。/,
    },
  ];

  for (const c of invalidCases) {
    test(`${c.name}は保存不可と表示し、確定できずDBを変更しない`, async ({ page }) => {
      const before = await dbSnapshot(ownerId);
      const region = await upload(page, c.body(s));
      await expect(region.getByRole('alert')).toContainText('競合またはエラーがあるため取り込めません。');
      await expect(region.getByText(/^エラー [1-9]\d*件$/)).toBeVisible();
      await expect(region.getByText(c.message).first()).toBeVisible();
      await expect(region.getByRole('button', { name: '取込を確定' })).toBeDisabled();
      await region.getByRole('button', { name: '取消' }).click();
      await expect(region).toBeHidden();
      expect(await dbSnapshot(ownerId)).toEqual(before);
    });
  }
});
