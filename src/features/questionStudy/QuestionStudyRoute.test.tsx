import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageSpy = vi.fn();
vi.mock('./StructuredQuestionStudyPage', () => ({
  StructuredQuestionStudyPage: (props: {
    initialScope: unknown; initialSubjectId?: string | null; onExit: () => void;
    onOpenDistribution?: (subjectId: string) => void;
  }) => {
    pageSpy(props);
    return <div data-testid="study-page">
      <output data-testid="scope">{JSON.stringify(props.initialScope)}</output>
      <output data-testid="subject">{String(props.initialSubjectId)}</output>
      <button type="button" onClick={props.onExit}>終了</button>
      <button type="button" onClick={() => props.onOpenDistribution?.('44444444-4444-4444-8444-444444444444')}>分布</button>
    </div>;
  },
}));

import { QUESTION_STUDY_ROUTE_DESCRIPTOR, QuestionStudyRoute } from './QuestionStudyRoute';

const UUID = '22222222-2222-4222-8222-222222222222';

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(entry: string) {
  return render(<MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/question-study" element={<QuestionStudyRoute />} />
      <Route path="*" element={null} />
    </Routes>
    <Location />
  </MemoryRouter>);
}

beforeEach(() => { pageSpy.mockClear(); });

describe('QuestionStudyRoute descriptor', () => {
  it('固定descriptorと認証必須・wide/narrow導線を提供する', () => {
    expect(QUESTION_STUDY_ROUTE_DESCRIPTOR).toMatchObject({
      id: 'questions.study',
      path: '/question-study',
      requiresAuth: true,
      navigation: { id: 'nav.questions.study', label: '設問学習', to: '/question-study', placements: ['wide', 'narrow'] },
    });
  });
});

describe('QuestionStudyRoute adapter contract', () => {
  it('scopeなしの直接表示では対象選択から始める', () => {
    renderAt('/question-study');
    expect(screen.getByTestId('scope').textContent).toBe('null');
  });

  it.each(['subject', 'material', 'chapter', 'keyword'] as const)('%s scopeで開始し再読込でも同じscopeを復元する', (kind) => {
    const entry = `/question-study?scope=${kind}&scopeId=${UUID.toUpperCase()}`;
    const { unmount } = renderAt(entry);
    expect(JSON.parse(screen.getByTestId('scope').textContent!)).toEqual({ kind, id: UUID });
    unmount();
    renderAt(entry);
    expect(JSON.parse(screen.getByTestId('scope').textContent!)).toEqual({ kind, id: UUID });
  });

  it('subjectIdで範囲選択の科目を復元する', () => {
    renderAt(`/question-study?subjectId=${UUID.toUpperCase()}`);
    expect(screen.getByTestId('scope').textContent).toBe('null');
    expect(screen.getByTestId('subject').textContent).toBe(UUID);
  });

  it('成績分布を開くと科目の分布routeへ遷移する', () => {
    renderAt('/question-study');
    fireEvent.click(screen.getByRole('button', { name: '分布' }));
    expect(screen.getByTestId('location').textContent)
      .toBe('/question-study/distribution?subjectId=44444444-4444-4444-8444-444444444444');
  });

  it('正常終了では検証済みreturnToへ戻る', () => {
    renderAt(`/question-study?scope=material&scopeId=${UUID}&returnTo=/materials/${UUID}/edit`);
    fireEvent.click(screen.getByRole('button', { name: '終了' }));
    expect(screen.getByTestId('location').textContent).toBe(`/materials/${UUID}/edit`);
  });

  it('returnTo省略時の正常終了は/questionsへ戻る', () => {
    renderAt('/question-study');
    fireEvent.click(screen.getByRole('button', { name: '終了' }));
    expect(screen.getByTestId('location').textContent).toBe('/questions');
  });

  it.each([
    ['scope片側欠落', '/question-study?scope=subject'],
    ['scopeId片側欠落', `/question-study?scopeId=${UUID}`],
    ['未知scope', `/question-study?scope=topic&scopeId=${UUID}`],
    ['不正UUID', '/question-study?scope=chapter&scopeId=not-a-uuid'],
    ['許可外returnTo', `/question-study?scope=keyword&scopeId=${UUID}&returnTo=https://evil.example`],
    ['重複scope', `/question-study?scope=keyword&scope=chapter&scopeId=${UUID}`],
    ['不正subjectId', '/question-study?subjectId=abc'],
    ['scopeとsubjectIdの併用', `/question-study?scope=subject&scopeId=${UUID}&subjectId=${UUID}`],
  ])('%sでは学習pageを描画せずerrorと/questions復帰を表示する', (_label, entry) => {
    renderAt(entry);
    expect(pageSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '設問へ戻る' }));
    expect(screen.getByTestId('location').textContent).toBe('/questions');
  });
});
