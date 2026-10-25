import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageSpy = vi.fn();
vi.mock('./QuestionDistributionPage', () => ({
  QuestionDistributionPage: (props: { subjectId: string; onExit: () => void }) => {
    pageSpy(props);
    return <div data-testid="distribution-page">
      <output data-testid="subject">{props.subjectId}</output>
      <button type="button" onClick={props.onExit}>戻る</button>
    </div>;
  },
}));

import { QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR, QuestionDistributionRoute } from './QuestionDistributionRoute';

const UUID = '33333333-3333-4333-8333-333333333333';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(entry: string) {
  return render(<MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/question-study/distribution" element={<QuestionDistributionRoute />} />
      <Route path="*" element={null} />
    </Routes>
    <Location />
  </MemoryRouter>);
}

beforeEach(() => { pageSpy.mockClear(); });

describe('QuestionDistributionRoute', () => {
  it('navigationを持たない認証必須descriptorを提供する', () => {
    expect(QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR).toMatchObject({
      id: 'questions.study.distribution', path: '/question-study/distribution', requiresAuth: true,
    });
    expect('navigation' in QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR).toBe(false);
  });

  it('subjectIdを小文字化して分布pageへ渡し、戻るで範囲選択の科目を復元するURLへ遷移する', () => {
    renderAt(`/question-study/distribution?subjectId=${UUID.toUpperCase()}`);
    expect(screen.getByTestId('subject').textContent).toBe(UUID);
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByTestId('location').textContent).toBe(`/question-study?subjectId=${UUID}`);
  });

  it.each([
    ['欠落', ''],
    ['不正UUID', '?subjectId=abc'],
    ['複数指定', `?subjectId=${UUID}&subjectId=${UUID}`],
  ])('%sでは集計せずerrorと範囲選択への導線を出す', (_, search) => {
    renderAt(`/question-study/distribution${search}`);
    expect(pageSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('成績分布を開けません');
    fireEvent.click(screen.getByRole('button', { name: '範囲選択へ戻る' }));
    expect(screen.getByTestId('location').textContent).toBe('/question-study');
  });
});
