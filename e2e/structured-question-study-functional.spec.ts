import { adminClient, ensureTestUser, seedMaterialWithKeyword, seedSubject } from './db';
import { expect, test, type Page } from './fixtures';

/**
 * 構造化設問学習の主要利用者経路。app-shell登録前のため、本番routeを認証済みsessionの
 * harness（e2e/harness/question-study.html）で描画し、本番API・ローカルSupabaseに対して検証する。
 */
test.describe.configure({ mode: 'serial' });

type Seeded = {
  subjectId: string; materialId: string; chapterId: string; keywordId: string;
  q1: string; q2: string; q3: string;
};

async function seedQuestions(ownerId: string): Promise<Seeded> {
  const subjectId = await seedSubject(ownerId, '基本情報');
  const { materialId, chapterId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId);
  // 教材・章・科目範囲は本文中のkeyword出現から候補を作るため、本文へkeywordを置く。
  const body = await adminClient().from('chapters').update({ body: '{{id=k71m2p}} の説明。' }).eq('id', chapterId);
  if (body.error) throw body.error;
  const rows = [
    { question_text: '一番目の設問', model_answer: 'ビット', choices: ['バイト', 'ワード'], explanation: '情報量の最小単位', sort_order: 0 },
    { question_text: '二番目の設問', model_answer: 'ニブル', choices: [], explanation: null, sort_order: 1 },
    { question_text: '三番目の設問', model_answer: 'オクテット', choices: ['ワード'], explanation: '8ビットのまとまり', sort_order: 2 },
  ].map((row) => ({ ...row, owner_id: ownerId, material_id: materialId, keyword_id: keywordId }));
  const inserted = await adminClient().from('structured_questions').insert(rows).select('id, sort_order');
  if (inserted.error) throw inserted.error;
  const id = (order: number) => inserted.data.find((row) => row.sort_order === order)!.id as string;
  return { subjectId, materialId, chapterId, keywordId, q1: id(0), q2: id(1), q3: id(2) };
}

/** 穴埋め側の履歴・統計の全行。構造化設問の学習前後で比較する。 */
async function fillInSnapshot(owner: string) {
  const db = adminClient();
  const logs = await db.from('answer_logs').select('*').eq('owner_id', owner).order('id');
  const stats = await db.from('keyword_stats').select('*').eq('owner_id', owner).order('keyword_id');
  if (logs.error) throw logs.error;
  if (stats.error) throw stats.error;
  return { logs: logs.data, stats: stats.data };
}

async function logs(owner: string) {
  const result = await adminClient().from('structured_question_answer_logs')
    .select('question_id, question_version, answer, mode, is_correct').eq('owner_id', owner);
  if (result.error) throw result.error;
  return result.data.map((row) => ({ ...row, question_version: Number(row.question_version) }));
}

async function stats(owner: string) {
  const result = await adminClient().from('structured_question_stats')
    .select('question_id, asked_count, correct_count').eq('owner_id', owner);
  if (result.error) throw result.error;
  return result.data;
}

async function flags(questionId: string) {
  const result = await adminClient().from('structured_questions')
    .select('doubt_flag, explanation_request_flag').eq('id', questionId).single();
  if (result.error) throw result.error;
  return result.data;
}

async function openStudy(page: Page, query = '') {
  await page.goto(`/e2e/harness/question-study.html${query}`);
}

async function startSession(page: Page, mode: '自動' | '選択式' | '記述式', total: number) {
  await expect(page.getByText(`対象 ${total} 問`)).toBeVisible();
  await page.getByRole('radiogroup', { name: '出題順' }).getByLabel('順番どおり').check();
  await page.getByRole('radiogroup', { name: '解答形式' }).getByLabel(mode).check();
  await page.getByRole('button', { name: '学習を開始' }).click();
}

const answerButton = (page: Page) => page.getByRole('button', { name: '解答する' });
const result = (page: Page) => page.getByRole('status');
const verdict = (page: Page, text: '正解' | '不正解') => result(page).getByText(text, { exact: true });

test('範囲選択から自動形式で正解・不正解・わからないを解き、解説と次問を経て完了し専用成績だけを記録する', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seedQuestions(owner);
  const before = await fillInSnapshot(owner);

  await openStudy(page);
  await expect(page.getByRole('heading', { name: '出題範囲を選んでください' })).toBeVisible();
  await page.getByLabel('科目').selectOption(s.subjectId);
  await page.getByLabel('教材').selectOption(s.materialId);
  await page.getByLabel('キーワード').selectOption(s.keywordId);
  await page.getByRole('button', { name: 'この範囲で設定する' }).click();
  await startSession(page, '自動', 3);

  // Q1: 選択肢あり・未出題 → 選択式。正解し、解説を確認する。
  await expect(page.getByRole('heading', { name: '一番目の設問' })).toBeVisible();
  await expect(page.getByLabel('進行状況')).toHaveText('0 / 3 問');
  await page.getByRole('radiogroup', { name: '選択肢' }).getByLabel('ビット', { exact: true }).check();
  await answerButton(page).click();
  await expect(verdict(page, '正解')).toBeVisible();
  await expect(page.getByRole('heading', { name: '解説' })).toBeVisible();
  await expect(page.getByText('情報量の最小単位')).toBeVisible();
  await page.getByRole('button', { name: '次の問題へ' }).click();

  // Q2: 選択肢なし → 記述式。不正解。
  await expect(page.getByRole('heading', { name: '二番目の設問' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: '選択肢' })).toHaveCount(0);
  await expect(answerButton(page)).toBeDisabled();
  await page.getByLabel('解答').fill('ちがう答え');
  await answerButton(page).click();
  await expect(verdict(page, '不正解')).toBeVisible();
  await expect(result(page)).toContainText('ニブル');
  await page.getByRole('button', { name: '次の問題へ' }).click();

  // Q3: わからない → 不正解。
  await expect(page.getByRole('heading', { name: '三番目の設問' })).toBeVisible();
  await page.getByRole('radiogroup', { name: '選択肢' }).getByLabel('わからない').check();
  await answerButton(page).click();
  await expect(verdict(page, '不正解')).toBeVisible();
  await expect(result(page)).toContainText('わからない');
  await page.getByRole('button', { name: '次の問題へ' }).click();

  await expect(page.getByRole('heading', { name: '学習が終わりました' })).toBeVisible();
  await expect(page.getByText('正解 1 / 3 問')).toBeVisible();

  const recorded = await logs(owner);
  expect(recorded).toHaveLength(3);
  expect(recorded).toEqual(expect.arrayContaining([
    { question_id: s.q1, question_version: 1, answer: 'ビット', mode: 'choice', is_correct: true },
    { question_id: s.q2, question_version: 1, answer: 'ちがう答え', mode: 'written', is_correct: false },
    { question_id: s.q3, question_version: 1, answer: '', mode: 'choice', is_correct: false },
  ]));
  const recordedStats = await stats(owner);
  expect(recordedStats).toHaveLength(3);
  expect(recordedStats).toEqual(expect.arrayContaining([
    { question_id: s.q1, asked_count: 1, correct_count: 1 },
    { question_id: s.q2, asked_count: 1, correct_count: 0 },
    { question_id: s.q3, asked_count: 1, correct_count: 0 },
  ]));
  expect(await fillInSnapshot(owner)).toEqual(before);
});

test('記述式指定ではURL範囲から開始し、途中終了で途中までの専用成績を表示する', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seedQuestions(owner);
  await openStudy(page, `?scope=material&scopeId=${s.materialId}`);
  await startSession(page, '記述式', 3);
  await expect(page.getByRole('heading', { name: '一番目の設問' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: '選択肢' })).toHaveCount(0);
  await page.getByLabel('解答').fill(' ビット ');
  await answerButton(page).click();
  await expect(verdict(page, '正解')).toBeVisible();
  await page.getByRole('button', { name: '学習を終える' }).click();
  await expect(page.getByRole('heading', { name: '学習を途中で終えました' })).toBeVisible();
  await expect(page.getByText('正解 1 / 1 問')).toBeVisible();
  expect(await logs(owner)).toEqual([
    { question_id: s.q1, question_version: 1, answer: ' ビット ', mode: 'written', is_correct: true },
  ]);
});

test('選択式指定では章範囲でも選択肢を出し、選択肢不足の設問は記述式にする', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seedQuestions(owner);
  await openStudy(page, `?scope=chapter&scopeId=${s.chapterId}`);
  await startSession(page, '選択式', 3);
  await expect(page.getByRole('heading', { name: '一番目の設問' })).toBeVisible();
  await page.getByRole('radiogroup', { name: '選択肢' }).getByLabel('バイト').check();
  await answerButton(page).click();
  await expect(verdict(page, '不正解')).toBeVisible();
  await page.getByRole('button', { name: '次の問題へ' }).click();
  await expect(page.getByRole('heading', { name: '二番目の設問' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: '選択肢' })).toHaveCount(0);
  await expect(page.getByLabel('解答')).toBeVisible();
  expect(await logs(owner)).toEqual([
    { question_id: s.q1, question_version: 1, answer: 'バイト', mode: 'choice', is_correct: false },
  ]);
});

test('記録失敗では判定と入力を保持して次問へ進ませず、明示再試行で1件だけ確定する', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seedQuestions(owner);
  const before = await fillInSnapshot(owner);
  let calls = 0;
  await page.route('**/rest/v1/rpc/record_structured_question_answer', async (route) => {
    calls += 1;
    if (calls === 1) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
    else await route.continue();
  });
  await openStudy(page, `?scope=keyword&scopeId=${s.keywordId}`);
  await startSession(page, '記述式', 3);
  await page.getByLabel('解答').fill('ビット');
  await answerButton(page).click();

  await expect(page.getByRole('alert')).toContainText('この回答は未記録です');
  await expect(verdict(page, '正解')).toBeVisible();
  await expect(result(page)).toContainText('ビット');
  await expect(page.getByRole('button', { name: '次の問題へ' })).toHaveCount(0);
  expect(await logs(owner)).toEqual([]);
  expect(await stats(owner)).toEqual([]);

  await page.getByRole('button', { name: '記録を再試行' }).click();
  await expect(page.getByRole('button', { name: '次の問題へ' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls).toBe(2);
  expect(await logs(owner)).toEqual([
    { question_id: s.q1, question_version: 1, answer: 'ビット', mode: 'written', is_correct: true },
  ]);
  expect(await stats(owner)).toEqual([{ question_id: s.q1, asked_count: 1, correct_count: 1 }]);
  expect(await fillInSnapshot(owner)).toEqual(before);
});

test('記録処理中は二重送信を受け付けず、履歴は1件だけになる', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seedQuestions(owner);
  let calls = 0;
  await page.route('**/rest/v1/rpc/record_structured_question_answer', async (route) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await openStudy(page, `?scope=keyword&scopeId=${s.keywordId}`);
  await startSession(page, '記述式', 3);
  await page.getByLabel('解答').fill('ビット');
  await answerButton(page).click();
  const busy = page.getByRole('button', { name: '記録しています…' });
  await expect(busy).toBeDisabled();
  await busy.click({ force: true });
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.getByRole('button', { name: '次の問題へ' })).toBeVisible();
  expect(calls).toBe(1);
  expect(await logs(owner)).toHaveLength(1);
  expect(await stats(owner)).toEqual([{ question_id: s.q1, asked_count: 1, correct_count: 1 }]);
});

test('表示後に設問versionが変わると古い回答を記録せず、最新版で再回答させる', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seedQuestions(owner);
  await openStudy(page, `?scope=keyword&scopeId=${s.keywordId}`);
  await startSession(page, '記述式', 3);
  await expect(page.getByRole('heading', { name: '一番目の設問' })).toBeVisible();
  const bumped = await adminClient().from('structured_questions')
    .update({ question_text: '更新された一番目の設問', model_answer: 'バイナリ' })
    .eq('id', s.q1).select('version').single();
  expect(bumped.error).toBeNull();
  expect(Number(bumped.data!.version)).toBe(2);

  await page.getByLabel('解答').fill('ビット');
  await answerButton(page).click();
  await expect(page.getByRole('alert')).toContainText('設問が更新されました');
  await expect(page.getByRole('heading', { name: '更新された一番目の設問' })).toBeVisible();
  expect(await logs(owner)).toEqual([]);
  expect(await stats(owner)).toEqual([]);

  await page.getByLabel('解答').fill('バイナリ');
  await answerButton(page).click();
  await expect(verdict(page, '正解')).toBeVisible();
  expect(await logs(owner)).toEqual([
    { question_id: s.q1, question_version: 2, answer: 'バイナリ', mode: 'written', is_correct: true },
  ]);
});

test('設問のない範囲は空状態を表示し、候補読取の失敗はエラーから再試行できる', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const emptySubject = await seedSubject(owner, '空の科目', 1);
  await openStudy(page, `?scope=subject&scopeId=${emptySubject}`);
  await expect(page.getByText('この範囲に出題できる設問はありません')).toBeVisible();
  await expect(page.getByRole('button', { name: '学習を開始' })).toHaveCount(0);

  const s = await seedQuestions(owner);
  let failed = false;
  await page.route('**/rest/v1/structured_questions*', async (route) => {
    if (!failed) { failed = true; await route.abort(); } else await route.continue();
  });
  await openStudy(page, `?scope=keyword&scopeId=${s.keywordId}`);
  await expect(page.getByRole('alert')).toContainText('設問を読み込めませんでした');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByText('対象 3 問')).toBeVisible();
});

test('結果画面で疑義と解説追加のflagを独立・同時に設定でき、既存解説ありでも追加flagを保存する', async ({ signedIn: page }) => {
  const owner = await ensureTestUser();
  const s = await seedQuestions(owner);
  const before = await fillInSnapshot(owner);
  await openStudy(page, `?scope=keyword&scopeId=${s.keywordId}`);
  await startSession(page, '記述式', 3);
  const saved = page.getByText('フラグを保存しました');
  const doubt = page.getByLabel('内容に疑義がある');
  const request = page.getByLabel('解説の追加を希望する');

  // Q1（解説あり）: 疑義だけ
  await page.getByLabel('解答').fill('ビット');
  await answerButton(page).click();
  await doubt.check();
  await expect(saved).toBeVisible();
  await expect(doubt).toBeChecked();
  await expect(request).not.toBeChecked();
  expect(await flags(s.q1)).toEqual({ doubt_flag: true, explanation_request_flag: false });
  await page.getByRole('button', { name: '次の問題へ' }).click();

  // Q2: 両方
  await page.getByLabel('解答').fill('ニブル');
  await answerButton(page).click();
  await doubt.check();
  await expect(saved).toBeVisible();
  await request.check();
  await expect(request).toBeChecked();
  await expect(doubt).toBeChecked();
  await expect.poll(() => flags(s.q2)).toEqual({ doubt_flag: true, explanation_request_flag: true });
  await page.getByRole('button', { name: '次の問題へ' }).click();

  // Q3（解説あり）: 解説追加だけ
  await page.getByLabel('解答').fill('ちがう');
  await answerButton(page).click();
  await expect(page.getByText('8ビットのまとまり')).toBeVisible();
  await request.check();
  await expect(saved).toBeVisible();
  await expect(doubt).not.toBeChecked();
  expect(await flags(s.q3)).toEqual({ doubt_flag: false, explanation_request_flag: true });
  expect(await flags(s.q1)).toEqual({ doubt_flag: true, explanation_request_flag: false });

  await page.getByRole('button', { name: '次の問題へ' }).click();
  await expect(page.getByText('正解 2 / 3 問')).toBeVisible();
  expect(await logs(owner)).toHaveLength(3);
  expect(await fillInSnapshot(owner)).toEqual(before);
});
