import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';

import type { ImportOperation, QuestionExchangeImportV1 } from '../src/features/questionExchange/types';
import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { signIn } from './fixtures';

/**
 * 交換画面の原子的commit・競合経路とUI適合（viewport、keyboard、alert/status）。
 * 本番routeを認証済みharnessで描画し、本番API・ローカルSupabaseに対して検証する。
 */
test.describe.configure({ mode: 'serial' });

const IMPORT_RPC_URL = '**/rest/v1/rpc/import_question_exchange';
const MARKER = 'UI注入失敗マーカー';
const TRIGGER = 'qx_ui_fault';
const content = { questionText: '取込後の問い', modelAnswer: '答え', choices: ['誤り'], explanation: '解説' };

function psql(sql: string): string {
  return execFileSync('docker', [
    'exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql,
  ], { encoding: 'utf8' }).trim();
}

/** 対象ownerかつmarker本文の行だけで失敗する一時triggerを作り、finallyで必ず消す。 */
async function withFaultTrigger<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
  const fn = `public.${TRIGGER}_fn`;
  psql([
    `create or replace function ${fn}() returns trigger language plpgsql as $f$ begin `
      + `if new.owner_id = '${ownerId}'::uuid and new.question_text = '${MARKER}' then `
      + `raise exception 'injected fault ${TRIGGER}'; end if; return new; end $f$`,
    `create trigger ${TRIGGER} before insert or update on public.structured_questions for each row execute function ${fn}()`,
  ].join('; '));
  try {
    return await run();
  } finally {
    psql(`drop trigger if exists ${TRIGGER} on public.structured_questions; drop function if exists ${fn}()`);
  }
}

type Seeded = { id: string; version: number };

async function seedQuestion(ownerId: string, materialId: string, keywordId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await adminClient().from('structured_questions').insert({
    owner_id: ownerId, material_id: materialId, keyword_id: keywordId, question_text: '古い問い', model_answer: '答え',
    choices: [], sort_order: 0, ...overrides,
  }).select('id, version').single();
  if (error) throw error;
  return data as Seeded;
}

async function questions(ownerId: string) {
  const { data, error } = await adminClient().from('structured_questions').select('*').eq('owner_id', ownerId).order('id');
  if (error) throw error;
  return data;
}

function update(keywordId: string, q: Seeded, flags: ('doubt' | 'explanation-request')[], resolved = flags, text = content.questionText): ImportOperation {
  return {
    kind: 'update', keywordId, questionId: q.id, expectedVersion: q.version,
    question: { ...content, questionText: text }, sourceRequestedFlags: flags, resolvedFlags: resolved,
  };
}

function fileBuffer(operations: ImportOperation[]) {
  const file: QuestionExchangeImportV1 = {
    schemaVersion: 1, exchangeId: 'e9000000-0000-4000-8000-0000000000ff', exportedAt: '2026-10-11T00:00:00Z', operations,
  };
  return { name: 'return.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file), 'utf8') };
}

async function uploadAndPreview(page: Page, operations: ImportOperation[]): Promise<Locator> {
  await page.getByLabel('返却ファイル（JSON）').setInputFiles(fileBuffer(operations));
  await page.getByRole('button', { name: 'previewを作成' }).click();
  const region = page.getByRole('region', { name: '取込preview' });
  await expect(region).toBeVisible();
  return region;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test.describe('QuestionExchangeCommitE2E / QuestionExchangeUiConformance', () => {
  let ownerId = '';
  let materialId = '';
  let keywordId = '';

  test.beforeEach(async ({ page }) => {
    ownerId = await ensureTestUser();
    await resetData(ownerId);
    const subjectId = await seedSubject(ownerId, '交換UI');
    ({ materialId, keywordId } = await seedMaterialWithKeyword(ownerId, subjectId, 'xu0001'));
    await signIn(page);
    await page.goto('/e2e/harness/question-exchange.html');
    await expect(page.getByRole('heading', { name: '設問交換', level: 1 })).toBeVisible();
  });

  test.afterEach(async () => {
    await resetData(ownerId);
  });

  test('create/update混在を一括保存し、片方だけ・両方のflag解除とfile外flagの保持を件数summaryに反映する', async ({ page }) => {
    const both = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, explanation_request_flag: true });
    const doubtOnly = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, explanation_request_flag: true, sort_order: 1 });
    const outside = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, explanation_request_flag: true, sort_order: 2 });

    const region = await uploadAndPreview(page, [
      { kind: 'create', keywordId, question: content },
      update(keywordId, both, ['doubt', 'explanation-request']),
      // 依頼は両方だが、返却内容は疑義だけへの対応を示す
      update(keywordId, doubtOnly, ['doubt', 'explanation-request'], ['doubt']),
    ]);
    await expect(region.getByText('新規 1件')).toBeVisible();
    await expect(region.getByText('更新 2件')).toBeVisible();
    await region.getByRole('button', { name: '取込を確定' }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText('追加 1件、更新 2件、疑義解除 2件、解説依頼解除 1件');
    await expect(region).toBeHidden();

    const rows = await questions(ownerId);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.id === both.id)).toMatchObject({ question_text: content.questionText, doubt_flag: false, explanation_request_flag: false, version: both.version + 1 });
    expect(rows.find((r) => r.id === doubtOnly.id)).toMatchObject({ doubt_flag: false, explanation_request_flag: true, version: doubtOnly.version + 1 });
    expect(rows.find((r) => r.id === outside.id)).toMatchObject({ question_text: '古い問い', doubt_flag: true, explanation_request_flag: true, version: outside.version });
    expect(rows.filter((r) => ![both.id, doubtOnly.id, outside.id].includes(r.id))).toEqual([
      expect.objectContaining({ question_text: content.questionText, keyword_id: keywordId }),
    ]);
  });

  test('他利用者のIDを含むfileは保存不可となり、commit payloadを差し替えても内容を漏らさず無書込で拒否される', async ({ page }) => {
    const credentials = { email: `exchange-ui-${randomUUID()}@example.com`, password: 'test-password-123' };
    const created = await adminClient().auth.admin.createUser({ ...credentials, email_confirm: true });
    if (created.error) throw created.error;
    const otherId = created.data.user.id;
    try {
      const foreign = await seedMaterialWithKeyword(otherId, await seedSubject(otherId, '他人の交換'), 'xu0002');
      const foreignQ = await seedQuestion(otherId, foreign.materialId, foreign.keywordId, { question_text: '他人の秘密設問', doubt_flag: true });
      const mine = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true });

      const region = await uploadAndPreview(page, [update(foreign.keywordId, foreignQ, ['doubt'])]);
      await expect(region.getByText('エラー 2件')).toBeVisible();
      await expect(region.getByRole('alert')).toContainText('取り込めません');
      await expect(region.getByRole('button', { name: '取込を確定' })).toBeDisabled();
      await expect(page.getByText('他人の秘密設問')).toHaveCount(0);
      await region.getByRole('button', { name: '取消' }).click();

      // 正当なpreviewを作り、送信直前に他人の参照へ差し替えてもDB側で全件拒否される
      const before = await questions(ownerId);
      const foreignBefore = await questions(otherId);
      await page.route(IMPORT_RPC_URL, async (route) => {
        const body = route.request().postData() ?? '';
        await route.continue({ postData: body.replaceAll(mine.id, foreignQ.id).replaceAll(keywordId, foreign.keywordId) });
      });
      const ok = await uploadAndPreview(page, [{ kind: 'create', keywordId, question: content }, update(keywordId, mine, ['doubt'])]);
      await ok.getByRole('button', { name: '取込を確定' }).click();
      const alert = ok.getByRole('alert');
      await expect(alert).toContainText('previewは保持しています');
      await expect(alert).not.toContainText('他人の秘密設問');
      await expect(ok.getByText('更新 1件')).toBeVisible();
      expect(await questions(ownerId)).toEqual(before);
      expect(await questions(otherId)).toEqual(foreignBefore);
    } finally {
      await resetData(otherId);
      await adminClient().auth.admin.deleteUser(otherId);
    }
  });

  test('commit中のDB内部失敗はerror alertへfocusし、previewを保持して部分保存も意図しないflag解除もしない', async ({ page }) => {
    const first = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, explanation_request_flag: true });
    const failing = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, sort_order: 1 });
    const region = await uploadAndPreview(page, [
      { kind: 'create', keywordId, question: content },
      update(keywordId, first, ['doubt', 'explanation-request']),
      update(keywordId, failing, ['doubt'], ['doubt'], MARKER),
    ]);
    const before = await questions(ownerId);

    await withFaultTrigger(ownerId, async () => {
      await region.getByRole('button', { name: '取込を確定' }).click();
      const alert = region.getByRole('alert');
      await expect(alert).toContainText('previewは保持しています');
      await expect(alert).toBeFocused();
    });
    await expect(region.getByText('更新 2件')).toBeVisible();
    await expect(region.getByRole('button', { name: '取込を確定' })).toBeEnabled();
    await expect(page.getByRole('status')).toHaveCount(0);
    const after = await questions(ownerId);
    expect(after).toEqual(before);
    expect(after.find((r) => r.id === first.id)).toMatchObject({ doubt_flag: true, explanation_request_flag: true });
  });

  test('確定を連続実行してもRPCは1回だけ送信され、処理中は確定と取消を受け付けない', async ({ page }) => {
    const q = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true });
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(IMPORT_RPC_URL, async (route) => {
      calls += 1;
      await gate;
      await route.continue();
    });
    const region = await uploadAndPreview(page, [update(keywordId, q, ['doubt'])]);
    const commit = region.getByRole('button', { name: '取込を確定' });
    // 再描画前の同一tickで2回clickし、submit guardを直接検証する
    await commit.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
    await expect(region.getByRole('status')).toContainText('取込中');
    await expect(commit).toBeDisabled();
    await expect(region.getByRole('button', { name: '取消' })).toBeDisabled();
    release();
    await expect(page.getByRole('status')).toContainText('追加 0件、更新 1件、疑義解除 1件、解説依頼解除 0件');
    expect(calls).toBe(1);
    expect((await questions(ownerId)).find((r) => r.id === q.id)).toMatchObject({ version: q.version + 1, doubt_flag: false });
  });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 780 }]) {
    test(`${viewport.width}px幅で条件入力・preview・summaryが横スクロールなしで操作できる`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const q = await seedQuestion(ownerId, materialId, keywordId, { doubt_flag: true, question_text: '長い'.repeat(80) });
      await expect(page.getByLabel('最低出題回数')).toBeVisible();
      await page.getByLabel('最大正答率').fill('5');
      await page.getByRole('button', { name: '対象を出力' }).click();
      await expect(page.getByLabel('最大正答率')).toHaveAttribute('aria-invalid', 'true');
      await expectNoHorizontalOverflow(page);

      const region = await uploadAndPreview(page, [
        { kind: 'create', keywordId, question: { ...content, questionText: 'とても長い返却設問'.repeat(40) } },
        update(keywordId, q, ['doubt']),
      ]);
      await region.getByRole('button', { name: '取込を確定' }).scrollIntoViewIfNeeded();
      await expectNoHorizontalOverflow(page);
      await region.getByRole('button', { name: '取込を確定' }).click();
      await expect(page.getByRole('status')).toContainText('追加 1件、更新 1件');
      await expectNoHorizontalOverflow(page);
    });
  }

  test('keyboardだけで条件誤りへのfocus、file選択、preview、確定ができ、alert/statusで通知される', async ({ page }) => {
    const q = await seedQuestion(ownerId, materialId, keywordId, { explanation_request_flag: true });
    const minimum = page.getByLabel('最低出題回数');
    for (let i = 0; i < 10 && !(await minimum.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
    await expect(minimum).toBeFocused();
    await page.keyboard.type('-1');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('最低出題回数')).toBeFocused();
    await expect(page.getByLabel('最低出題回数')).toHaveAttribute('aria-invalid', 'true');

    const fileInput = page.getByLabel('返却ファイル（JSON）');
    for (let i = 0; i < 10 && !(await fileInput.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
    await expect(fileInput).toBeFocused();
    // OSのfile dialogは操作できないため、focus後にsetInputFilesで選択を代替する
    await fileInput.setInputFiles(fileBuffer([update(keywordId, q, ['explanation-request'])]));
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'previewを作成' })).toBeFocused();
    await page.keyboard.press('Enter');
    const region = page.getByRole('region', { name: '取込preview' });
    await expect(region.getByText('更新 1件')).toBeVisible();

    const commit = region.getByRole('button', { name: '取込を確定' });
    for (let i = 0; i < 20 && !(await commit.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
    await expect(commit).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('status')).toContainText('追加 0件、更新 1件、疑義解除 0件、解説依頼解除 1件');
  });

  test('keyboardで不正fileは区分別エラーとalertで識別でき、preview読込失敗時はerror alertへfocusし再試行に到達できる', async ({ page }) => {
    const fileInput = page.getByLabel('返却ファイル（JSON）');
    await fileInput.focus();
    await fileInput.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{not json', 'utf8') });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const region = page.getByRole('region', { name: '取込preview' });
    await expect(region.getByText('エラー 1件')).toBeVisible();
    await expect(region.getByRole('alert')).toContainText('取り込めません');
    await expect(region.getByText('JSONとして解析できません')).toBeVisible();
    await expect(region.getByRole('button', { name: '取込を確定' })).toBeDisabled();

    // previewの現在状態読込を通信失敗させると、操作文脈と再試行を示すalertへfocusが移る
    await page.route('**/rest/v1/**', (route) => route.abort());
    await fileInput.focus();
    await fileInput.setInputFiles(fileBuffer([{ kind: 'create', keywordId, question: content }]));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('再試行してください');
    await expect(alert).toBeFocused();
    await page.unroute('**/rest/v1/**');
    await page.keyboard.press('Tab');
    const retry = page.getByRole('button', { name: 'previewを再試行' });
    await expect(retry).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: '取込preview' }).getByText('新規 1件')).toBeVisible();
  });
});
