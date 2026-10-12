import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 環境変数のないCIでも読み込めるよう、Supabaseクライアントは spy 可能な最小形に差し替える。
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: vi.fn() }, from: vi.fn() } }));

import { supabase } from '@/lib/supabase';
import {
  QUESTION_BANK_ROUTE_DESCRIPTOR,
  QuestionBankRoute,
  loadQuestionBankRouteContext,
  type QuestionBankRouteLoader,
} from './QuestionBankRoute';
import type { QuestionBankApi } from './QuestionBankPage';

const IDS = {
  subject: '11111111-1111-4111-8111-111111111111',
  material: '22222222-2222-4222-8222-222222222222',
  chapter: '33333333-3333-4333-8333-333333333333',
  keyword: '44444444-4444-4444-8444-444444444444',
};
const GENERAL_UUID = 'aaaaaaaa-aaaa-0000-0000-aaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbb-bbbb-0000-0000-bbbbbbbbbbbb';

const bankApi: QuestionBankApi = {
  listQuestionsByKeyword: vi.fn().mockResolvedValue([]),
  saveQuestion: vi.fn(),
  setQuestionFlags: vi.fn(),
  setQuestionActive: vi.fn(),
  reorderQuestions: vi.fn(),
  deleteQuestion: vi.fn(),
};

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type CatalogRow = Record<string, unknown>;

function installCatalogMock(tables: Record<string, CatalogRow[]>) {
  const ranges: Array<{ table: string; from: number; to: number }> = [];
  vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'owner' } }, error: null } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>);
  const from = vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
    const filters: Array<(row: CatalogRow) => boolean> = [];
    const visible = () => (tables[table] ?? []).filter((row) => row.owner_id === undefined || row.owner_id === 'owner').filter((row) => filters.every((filter) => filter(row)));
    const response = () => ({ data: visible(), error: null, count: visible().length });
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn((column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; });
    query.in = vi.fn((column: string, values: readonly unknown[]) => { filters.push((row) => values.includes(row[column])); return query; });
    query.order = vi.fn(() => query);
    query.range = vi.fn(async (rangeFrom: number, to: number) => {
      ranges.push({ table, from: rangeFrom, to });
      const rows = visible();
      return { data: rows.slice(rangeFrom, to + 1), error: null, count: rows.length };
    });
    query.maybeSingle = vi.fn(async () => {
      const rows = visible();
      return { data: rows.length === 1 ? rows[0] : null, error: null };
    });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve);
    return query as unknown as ReturnType<typeof supabase.from>;
  }) as typeof supabase.from);
  return { from, ranges };
}

function renderRoute(initialEntry: string, loader: QuestionBankRouteLoader) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/questions" element={<><QuestionBankRoute loader={loader} bankApi={bankApi} /><Location /></>} />
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoQuestionWrite(): void {
  expect(bankApi.saveQuestion).not.toHaveBeenCalled();
  expect(bankApi.setQuestionFlags).not.toHaveBeenCalled();
  expect(bankApi.setQuestionActive).not.toHaveBeenCalled();
  expect(bankApi.reorderQuestions).not.toHaveBeenCalled();
  expect(bankApi.deleteQuestion).not.toHaveBeenCalled();
}

describe('QuestionBankRoute adapter contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bankApi.listQuestionsByKeyword).mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('app-shellへ固定descriptorをfeature-localな構造として提供する', () => {
    expect(QUESTION_BANK_ROUTE_DESCRIPTOR).toMatchObject({
      id: 'questions.bank',
      path: '/questions',
      requiresAuth: true,
      navigation: {
        id: 'nav.questions.bank',
        label: '設問',
        to: '/questions',
        placements: ['wide', 'narrow'],
      },
    });
  });

  it('search付き直開きと再読込で階層を一度だけ検証しkeywordから開始する', async () => {
    const loader = vi.fn<QuestionBankRouteLoader>().mockResolvedValue({
      subjectId: IDS.subject,
      materialId: IDS.material,
      chapterId: IDS.chapter,
      keyword: { id: IDS.keyword, materialId: IDS.material, label: '用語' },
    });
    const query = `subjectId=${IDS.subject}&materialId=${IDS.material}&chapterId=${IDS.chapter}&keywordId=${IDS.keyword}&returnTo=%2Fquestions`;

    const first = renderRoute(`/questions?${query}`, loader);
    expect(await screen.findByText('キーワード: 用語')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith({
      subjectId: IDS.subject,
      materialId: IDS.material,
      chapterId: IDS.chapter,
      keywordId: IDS.keyword,
    });

    first.unmount();
    renderRoute(`/questions?${query}`, loader);
    expect(await screen.findByText('キーワード: 用語')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['全省略', '/questions'],
    ['科目', `/questions?subjectId=${IDS.subject}`],
    ['教材', `/questions?materialId=${IDS.material}`],
    ['章', `/questions?chapterId=${IDS.chapter}`],
  ])('%sスコープから認可済みkeywordを選択して設問バンクを開始する', async (_label, entry) => {
    const loader = vi.fn<QuestionBankRouteLoader>().mockResolvedValue({
      subjectId: IDS.subject,
      materialId: IDS.material,
      chapterId: null,
      keyword: null,
      keywords: [{ id: IDS.keyword, materialId: IDS.material, label: '選択用語' }],
    });
    renderRoute(entry, loader);

    fireEvent.click(await screen.findByRole('button', { name: '選択用語' }));
    expect(await screen.findByText('キーワード: 選択用語')).toBeInTheDocument();
  });

  it('version/variantを限定しない一般UUIDを受け入れる', async () => {
    const loader = vi.fn<QuestionBankRouteLoader>().mockResolvedValue({
      subjectId: null,
      materialId: GENERAL_UUID,
      chapterId: null,
      keyword: { id: GENERAL_UUID, materialId: GENERAL_UUID, label: '一般UUID' },
      keywords: [],
    });
    renderRoute(`/questions?materialId=${GENERAL_UUID}&keywordId=${GENERAL_UUID}`, loader);

    expect(await screen.findByText('キーワード: 一般UUID')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['完了', '/', '%2F'],
    ['取消', '/questions', '%2Fquestions'],
    ['完了', `/subjects/${IDS.subject}`, `%2Fsubjects%2F${IDS.subject}`],
    ['取消', `/materials/${IDS.material}/edit`, `%2Fmaterials%2F${IDS.material}%2Fedit`],
  ])('%sは許可済みreturnTo %s へ復帰する', async (action, expected, encoded) => {
    const loader = vi.fn<QuestionBankRouteLoader>().mockResolvedValue({
      subjectId: IDS.subject,
      materialId: IDS.material,
      chapterId: null,
      keyword: { id: IDS.keyword, materialId: IDS.material, label: '用語' },
    });
    renderRoute(`/questions?materialId=${IDS.material}&keywordId=${IDS.keyword}&returnTo=${encoded}`, loader);

    fireEvent.click(await screen.findByRole('button', { name: action }));
    expect(await screen.findByTestId('location')).toHaveTextContent(expected);
  });

  it.each([
    ['不正UUID', `keywordId=not-a-uuid`],
    ['重複parameter', `keywordId=${IDS.keyword}&keywordId=${IDS.keyword}`],
    ['親子不一致', `materialId=${IDS.material}&keywordId=${IDS.keyword}`],
    ['許可外returnTo', `keywordId=${IDS.keyword}&returnTo=https%3A%2F%2Fevil.example`],
    ['protocol-relative returnTo', `keywordId=${IDS.keyword}&returnTo=%2F%2Fevil.example`],
    ['dot segment returnTo', `keywordId=${IDS.keyword}&returnTo=%2Fsubjects%2F..`],
    ['fragment returnTo', `keywordId=${IDS.keyword}&returnTo=%2Fquestions%23part`],
    ['nested query returnTo', `keywordId=${IDS.keyword}&returnTo=%2Fquestions%3FreturnTo%3D%252F`],
    ['二重encode returnTo', `keywordId=${IDS.keyword}&returnTo=%252Fquestions`],
  ])('%sではPageを開始せずerrorと安全な復帰だけを表示する', async (_label, query) => {
    const loader = vi.fn<QuestionBankRouteLoader>().mockResolvedValue(null);
    renderRoute(`/questions?${query}`, loader);

    expect(await screen.findByRole('alert')).toHaveTextContent('設問バンクを開けません');
    if (_label === '親子不一致') expect(loader).toHaveBeenCalledTimes(1);
    else expect(loader).not.toHaveBeenCalled();
    expect(bankApi.listQuestionsByKeyword).not.toHaveBeenCalled();
    expectNoQuestionWrite();
    fireEvent.click(screen.getByRole('button', { name: 'ホームへ戻る' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/');
  });

  it('権限外keywordは内容を表示せず安全な復帰を提示する', async () => {
    const loader = vi.fn<QuestionBankRouteLoader>().mockResolvedValue(null);
    renderRoute(`/questions?keywordId=${IDS.keyword}`, loader);

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).toHaveTextContent('設問バンクを開けません');
    expect(bankApi.listQuestionsByKeyword).not.toHaveBeenCalled();
    expectNoQuestionWrite();
  });

  it('loader rejectionを安全な同一errorへ変換する', async () => {
    const loader = vi.fn<QuestionBankRouteLoader>().mockRejectedValue(new Error('network'));
    renderRoute(`/questions?keywordId=${IDS.keyword}`, loader);
    expect(await screen.findByRole('alert')).toHaveTextContent('設問バンクを開けません');
    expectNoQuestionWrite();
  });

  it('search変更の旧応答が新しいkeyword文脈を上書きしない', async () => {
    const first = deferred<Awaited<ReturnType<QuestionBankRouteLoader>>>();
    const loader = vi.fn<QuestionBankRouteLoader>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        subjectId: null, materialId: IDS.material, chapterId: null,
        keyword: { id: GENERAL_UUID, materialId: IDS.material, label: '新しい用語' }, keywords: [],
      });
    function ChangeSearch() {
      const navigate = useNavigate();
      return <button onClick={() => navigate(`/questions?keywordId=${GENERAL_UUID}`)}>検索変更</button>;
    }
    render(<MemoryRouter initialEntries={[`/questions?keywordId=${IDS.keyword}`]}><Routes>
      <Route path="/questions" element={<><ChangeSearch /><QuestionBankRoute loader={loader} bankApi={bankApi} /></>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '検索変更' }));
    expect(await screen.findByText('キーワード: 新しい用語')).toBeInTheDocument();
    await waitFor(() => expect(bankApi.listQuestionsByKeyword).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve({
        subjectId: null, materialId: IDS.material, chapterId: null,
        keyword: { id: IDS.keyword, materialId: IDS.material, label: '古い用語' }, keywords: [],
      });
      await first.promise;
      await Promise.resolve();
    });
    expect(screen.queryByText('キーワード: 古い用語')).not.toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(bankApi.listQuestionsByKeyword).toHaveBeenCalledTimes(1);
    expect(bankApi.listQuestionsByKeyword).toHaveBeenCalledWith(GENERAL_UUID);
  });

  it('unmount後のloader完了ではPage読取を開始しない', async () => {
    const pending = deferred<Awaited<ReturnType<QuestionBankRouteLoader>>>();
    const loader = vi.fn<QuestionBankRouteLoader>().mockReturnValue(pending.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderRoute(`/questions?keywordId=${IDS.keyword}`, loader);
    view.unmount();
    await act(async () => {
      pending.resolve({
        subjectId: null, materialId: IDS.material, chapterId: null,
        keyword: { id: IDS.keyword, materialId: IDS.material, label: '遅延用語' }, keywords: [],
      });
      await pending.promise;
      await Promise.resolve();
    });
    expect(bankApi.listQuestionsByKeyword).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('loadQuestionBankRouteContext', () => {
  afterEach(() => vi.restoreAllMocks());

  it('未認証ではcatalogを照会せずnullを返す', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: null } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>);
    const from = vi.spyOn(supabase, 'from');
    await expect(loadQuestionBankRouteContext({ subjectId: null, materialId: null, chapterId: null, keywordId: IDS.keyword })).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('所有外keywordと親子不一致を同じnull結果にする', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'owner' } }, error: null } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>);
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: IDS.keyword, material_id: IDS.material, chapter_id: null, answers: ['用語'] }, error: null });
    const chain: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; maybeSingle: typeof maybeSingle } = {
      select: vi.fn(), eq: vi.fn(), maybeSingle,
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    vi.spyOn(supabase, 'from').mockReturnValue(chain as unknown as ReturnType<typeof supabase.from>);

    const keywordOnly = { subjectId: null, materialId: null, chapterId: null, keywordId: IDS.keyword };
    await expect(loadQuestionBankRouteContext(keywordOnly)).resolves.toBeNull();
    await expect(loadQuestionBankRouteContext({ ...keywordOnly, materialId: GENERAL_UUID })).resolves.toBeNull();
  });

  it('全省略ではRLS可視keywordをページングして全件返す', async () => {
    const keywords = Array.from({ length: 1001 }, (_, index) => ({
      id: `keyword-${index}`, material_id: IDS.material, answers: [`用語${index}`], owner_id: 'owner',
    }));
    keywords.push({ id: 'hidden', material_id: OTHER_UUID, answers: ['他人'], owner_id: 'other' });
    const catalog = installCatalogMock({ keywords });

    const result = await loadQuestionBankRouteContext({ subjectId: null, materialId: null, chapterId: null, keywordId: null });
    expect(result?.keywords).toHaveLength(1001);
    expect(result?.keywords?.some(({ label }) => label === '他人')).toBe(false);
    expect(catalog.ranges.filter(({ table }) => table === 'keywords')).toEqual([
      { table: 'keywords', from: 0, to: 999 },
      { table: 'keywords', from: 1000, to: 1999 },
    ]);
  });

  it.each([
    ['subject', { subjectId: IDS.subject, materialId: null, chapterId: null, keywordId: null }],
    ['material', { subjectId: null, materialId: IDS.material, chapterId: null, keywordId: null }],
    ['chapter', { subjectId: null, materialId: null, chapterId: IDS.chapter, keywordId: null }],
  ])('%s scopeで実catalog親子関係を検証して対象keywordだけ返す', async (_scope, parameters) => {
    const catalog = installCatalogMock({
      subjects: [{ id: IDS.subject, owner_id: 'owner' }],
      materials: [
        { id: IDS.material, subject_id: IDS.subject, owner_id: 'owner' },
        { id: OTHER_UUID, subject_id: GENERAL_UUID, owner_id: 'owner' },
      ],
      chapters: [{ id: IDS.chapter, material_id: IDS.material, owner_id: 'owner' }],
      keywords: [
        { id: IDS.keyword, material_id: IDS.material, chapter_id: IDS.chapter, answers: ['対象'], owner_id: 'owner' },
        { id: GENERAL_UUID, material_id: OTHER_UUID, chapter_id: null, answers: ['対象外'], owner_id: 'owner' },
      ],
    });

    const result = await loadQuestionBankRouteContext(parameters);
    expect(result?.keywords?.map(({ label }) => label)).toEqual(['対象']);
    expect(catalog.from).toHaveBeenCalled();
  });

  it('keywordからchapter・material・subjectまで成功連鎖を検証する', async () => {
    installCatalogMock({
      subjects: [{ id: IDS.subject, owner_id: 'owner' }],
      materials: [{ id: IDS.material, subject_id: IDS.subject, owner_id: 'owner' }],
      chapters: [{ id: IDS.chapter, material_id: IDS.material, owner_id: 'owner' }],
      keywords: [{ id: IDS.keyword, material_id: IDS.material, chapter_id: IDS.chapter, answers: ['対象'], owner_id: 'owner' }],
    });
    await expect(loadQuestionBankRouteContext({
      subjectId: IDS.subject, materialId: IDS.material, chapterId: IDS.chapter, keywordId: IDS.keyword,
    })).resolves.toEqual({
      subjectId: IDS.subject,
      materialId: IDS.material,
      chapterId: IDS.chapter,
      keyword: { id: IDS.keyword, materialId: IDS.material, label: '対象' },
      keywords: [],
    });
  });

  it.each([
    ['chapter-material', { subjectId: null, materialId: OTHER_UUID, chapterId: IDS.chapter, keywordId: null }],
    ['material-subject', { subjectId: GENERAL_UUID, materialId: IDS.material, chapterId: null, keywordId: null }],
  ])('%s不一致をkeyword読取前に拒否する', async (_case, parameters) => {
    const catalog = installCatalogMock({
      subjects: [{ id: IDS.subject, owner_id: 'owner' }],
      materials: [{ id: IDS.material, subject_id: IDS.subject, owner_id: 'owner' }],
      chapters: [{ id: IDS.chapter, material_id: IDS.material, owner_id: 'owner' }],
      keywords: [{ id: IDS.keyword, material_id: IDS.material, chapter_id: IDS.chapter, answers: ['対象'], owner_id: 'owner' }],
    });
    await expect(loadQuestionBankRouteContext(parameters)).resolves.toBeNull();
    expect(catalog.ranges.some(({ table }) => table === 'keywords')).toBe(false);
  });
});
