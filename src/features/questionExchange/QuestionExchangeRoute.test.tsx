import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageSpy = vi.fn();
vi.mock('./QuestionExchangePage', () => ({
  QuestionExchangePage: (props: unknown) => {
    pageSpy(props);
    return <div data-testid="exchange-page" />;
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  QUESTION_EXCHANGE_ROUTE_DESCRIPTOR,
  QuestionExchangeRoute,
  type QuestionExchangeHierarchyLoader,
} from './QuestionExchangeRoute';

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const MATERIAL = '22222222-2222-4222-8222-222222222222';
const CHAPTER = '33333333-3333-4333-8333-333333333333';
const KEYWORD = '44444444-4444-4444-8444-444444444444';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(entry: string, loader: QuestionExchangeHierarchyLoader) {
  return render(<MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/question-exchange" element={<QuestionExchangeRoute loader={loader} />} />
      <Route path="*" element={null} />
    </Routes>
    <Location />
  </MemoryRouter>);
}

let loader: ReturnType<typeof vi.fn<QuestionExchangeHierarchyLoader>>;
beforeEach(() => {
  pageSpy.mockClear();
  loader = vi.fn<QuestionExchangeHierarchyLoader>(async () => true);
});

describe('QuestionExchangeRoute descriptor', () => {
  it('固定descriptorと認証必須・wide導線を提供する', () => {
    expect(QUESTION_EXCHANGE_ROUTE_DESCRIPTOR).toMatchObject({
      id: 'questions.exchange',
      path: '/question-exchange',
      requiresAuth: true,
      navigation: { id: 'nav.questions.exchange', label: '設問交換', to: '/question-exchange', placements: ['wide'] },
    });
  });
});

describe('QuestionExchangeRoute adapter contract', () => {
  it('parameterなしの直接表示では階層照会なしで交換画面を表示する', async () => {
    renderAt('/question-exchange', loader);
    expect(await screen.findByTestId('exchange-page')).toBeTruthy();
    expect(loader).not.toHaveBeenCalled();
  });

  it('開始文脈の階層UUIDを正規化して検証し、再読込でも同じ文脈で表示する', async () => {
    const entry = `/question-exchange?subjectId=${SUBJECT.toUpperCase()}&materialId=${MATERIAL}&chapterId=${CHAPTER}&keywordId=${KEYWORD}`;
    const { unmount } = renderAt(entry, loader);
    expect(await screen.findByTestId('exchange-page')).toBeTruthy();
    unmount();
    renderAt(entry, loader);
    expect(await screen.findByTestId('exchange-page')).toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenLastCalledWith({ subjectId: SUBJECT, materialId: MATERIAL, chapterId: CHAPTER, keywordId: KEYWORD });
  });

  it('正常終了と取消は検証済みreturnToへ戻る', async () => {
    renderAt(`/question-exchange?returnTo=${encodeURIComponent(`/materials/${MATERIAL}/edit`)}`, loader);
    fireEvent.click(await screen.findByRole('button', { name: '完了' }));
    expect(screen.getByTestId('location').textContent).toBe(`/materials/${MATERIAL}/edit`);
  });

  it('returnTo未指定の取消は/questionsへ戻る', async () => {
    renderAt('/question-exchange', loader);
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(screen.getByTestId('location').textContent).toBe('/questions');
  });

  it.each([
    ['不正UUID', `/question-exchange?materialId=not-a-uuid`],
    ['重複parameter', `/question-exchange?subjectId=${SUBJECT}&subjectId=${SUBJECT}`],
    ['許可外returnTo', `/question-exchange?returnTo=${encodeURIComponent('https://evil.example')}`],
    ['相対外returnTo', `/question-exchange?returnTo=${encodeURIComponent('//evil.example')}`],
  ])('%sでは交換画面を描画せず照会もせずerrorと/questions復帰を示す', async (_label, entry) => {
    renderAt(entry, loader);
    expect((await screen.findByRole('alert')).textContent).toContain('設問交換を開けません');
    expect(screen.queryByTestId('exchange-page')).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '設問へ戻る' }));
    expect(screen.getByTestId('location').textContent).toBe('/questions');
  });

  it.each([
    ['階層不一致', async () => false],
    ['照会失敗', async () => { throw new Error('network'); }],
  ])('%sでは交換画面を描画せずerrorと/questions復帰を示す', async (_label, impl) => {
    loader.mockImplementation(impl as QuestionExchangeHierarchyLoader);
    renderAt(`/question-exchange?subjectId=${SUBJECT}&materialId=${MATERIAL}&returnTo=/`, loader);
    expect((await screen.findByRole('alert')).textContent).toContain('設問交換を開けません');
    expect(screen.queryByTestId('exchange-page')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '設問へ戻る' }));
    expect(screen.getByTestId('location').textContent).toBe('/questions');
  });
});
