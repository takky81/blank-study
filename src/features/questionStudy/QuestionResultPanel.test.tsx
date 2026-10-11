// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ConsumerFlagMutationResult, StructuredQuestion } from '@/features/questions/types';
import { QuestionResultPanel, type QuestionFlagSetter } from './QuestionResultPanel';

const question: StructuredQuestion = {
  id: 'q1', ownerId: 'o', materialId: 'm', keywordId: 'k',
  questionText: '光合成とは？', modelAnswer: '化学反応', choices: [], explanation: '光で糖を作る反応',
  sortOrder: 0, isActive: true, doubtFlag: false, explanationRequestFlag: false,
  version: 3, updatedAt: '2026-10-11T00:00:00Z',
};

const saved = (patch: Partial<StructuredQuestion>, version: number): ConsumerFlagMutationResult => ({
  kind: 'saved',
  question: { ...question, ...patch, version },
});

function setup(setFlags: QuestionFlagSetter, overrides: Partial<StructuredQuestion> = {}) {
  const onNext = vi.fn();
  const onFinish = vi.fn();
  const onQuestionUpdated = vi.fn();
  const utils = render(<QuestionResultPanel question={{ ...question, ...overrides }} answer="物理"
    isCorrect={false} onNext={onNext} onFinish={onFinish} onQuestionUpdated={onQuestionUpdated}
    setFlags={setFlags} />);
  return { onNext, onFinish, onQuestionUpdated, ...utils };
}

describe('QuestionResultPanel', () => {
  it('設問文・利用者回答・正誤・模範解答・解説・次問／終了操作を表示する', () => {
    const { onNext, onFinish } = setup(vi.fn());
    expect(screen.getByText('光合成とは？')).toBeInTheDocument();
    expect(screen.getByText('物理')).toBeInTheDocument();
    expect(screen.getByText('不正解')).toBeInTheDocument();
    expect(screen.getByText('化学反応')).toBeInTheDocument();
    expect(screen.getByText('光で糖を作る反応')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次の問題へ' }));
    fireEvent.click(screen.getByRole('button', { name: '学習を終える' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('解説がなければ解説欄を出さず、未回答は「わからない」と示す', () => {
    render(<QuestionResultPanel question={{ ...question, explanation: null }} answer="" isCorrect={false}
      onNext={vi.fn()} onFinish={vi.fn()} onQuestionUpdated={vi.fn()} setFlags={vi.fn()} />);
    expect(screen.queryByText('解説')).not.toBeInTheDocument();
    expect(screen.getByText('わからない')).toBeInTheDocument();
  });

  it('疑義と解説追加を独立に、続けて同時に設定し、最新versionを使う', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockResolvedValueOnce(saved({ doubtFlag: true }, 4))
      .mockResolvedValueOnce(saved({ doubtFlag: true, explanationRequestFlag: true }, 5));
    const { onQuestionUpdated } = setup(setFlags);
    fireEvent.click(screen.getByRole('checkbox', { name: '内容に疑義がある' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '内容に疑義がある' })).toBeChecked());
    expect(setFlags).toHaveBeenLastCalledWith('q1', 3, { doubtFlag: true });
    expect(onQuestionUpdated).toHaveBeenLastCalledWith(expect.objectContaining({ version: 4, doubtFlag: true }));
    // 既存解説があっても解説追加を設定できる
    const request = screen.getByRole('checkbox', { name: '解説の追加を希望する' });
    expect(request).toBeEnabled();
    fireEvent.click(request);
    await waitFor(() => expect(request).toBeChecked());
    expect(setFlags).toHaveBeenLastCalledWith('q1', 4, { explanationRequestFlag: true });
    expect(screen.getByRole('checkbox', { name: '内容に疑義がある' })).toBeChecked();
  });

  it('flag失敗では表示を確定前へ戻し、判定結果を保持して再試行を案内する', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>().mockRejectedValue(new Error('network'));
    setup(setFlags);
    const doubt = screen.getByRole('checkbox', { name: '内容に疑義がある' });
    fireEvent.click(doubt);
    expect(await screen.findByRole('alert')).toHaveTextContent('もう一度');
    expect(doubt).not.toBeChecked();
    expect(doubt).toBeEnabled();
    expect(screen.getByText('不正解')).toBeInTheDocument();
  });

  it('version競合では自動上書きせず再読込を促す', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>().mockResolvedValue({
      kind: 'version-conflict', current: { ...question, version: 9 },
    });
    const { onQuestionUpdated } = setup(setFlags);
    const doubt = screen.getByRole('checkbox', { name: '内容に疑義がある' });
    fireEvent.click(doubt);
    expect(await screen.findByRole('alert')).toHaveTextContent('再読み込み');
    expect(setFlags).toHaveBeenCalledTimes(1);
    expect(doubt).not.toBeChecked();
    expect(onQuestionUpdated).not.toHaveBeenCalled();
  });
});
