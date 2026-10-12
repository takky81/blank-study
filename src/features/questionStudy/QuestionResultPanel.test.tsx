// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ConsumerFlagMutationResult, StructuredQuestion } from '@/features/questions/types';
import { QuestionResultPanel, type QuestionFlagSetter } from './QuestionResultPanel';

const question: StructuredQuestion = {
  id: 'q1', ownerId: 'o', materialId: 'm', keywordId: 'k',
  questionText: '光合成とは？', modelAnswer: '化学反応', choices: [], explanation: '光で糖を作る反応',
  sortOrder: 0, isActive: true, doubtFlag: false, doubtNote: null, explanationRequestFlag: false,
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

  it('疑義を確定すると任意の疑義内容を入力して同じ版付き契約で保存できる', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockResolvedValueOnce(saved({ doubtFlag: true }, 4))
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtNote: '答えが古い' }, 5));
    const { onQuestionUpdated } = setup(setFlags);
    expect(screen.queryByLabelText('疑義の内容（任意）')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '内容に疑義がある' }));
    const note = await screen.findByLabelText('疑義の内容（任意）');
    expect(note).toHaveValue('');
    fireEvent.change(note, { target: { value: '  答えが古い  ' } });
    fireEvent.click(screen.getByRole('button', { name: '疑義の内容を保存' }));
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 4, { doubtFlag: true, doubtNote: '答えが古い' }));
    await waitFor(() => expect(onQuestionUpdated).toHaveBeenLastCalledWith(expect.objectContaining({ version: 5, doubtNote: '答えが古い' })));
    expect(screen.getByText('疑義の内容を保存しました')).toBeInTheDocument();
  });

  it('既存の疑義内容を初期表示し、空にして保存するとnullを送り、解除で入力欄を隠す', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtNote: null }, 4))
      .mockResolvedValueOnce(saved({ doubtFlag: false, doubtNote: null }, 5));
    setup(setFlags, { doubtFlag: true, doubtNote: '既存メモ' });
    const note = screen.getByLabelText('疑義の内容（任意）');
    expect(note).toHaveValue('既存メモ');
    fireEvent.change(note, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '疑義の内容を保存' }));
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 3, { doubtFlag: true, doubtNote: null }));
    fireEvent.click(screen.getByRole('checkbox', { name: '内容に疑義がある' }));
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 4, { doubtFlag: false }));
    await waitFor(() => expect(screen.queryByLabelText('疑義の内容（任意）')).not.toBeInTheDocument());
  });

  it('疑義内容の保存失敗では入力を保持して再試行を案内し、競合では再読み込みを促す', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ kind: 'version-conflict', current: { ...question, version: 9 } });
    setup(setFlags, { doubtFlag: true });
    const note = screen.getByLabelText('疑義の内容（任意）');
    fireEvent.change(note, { target: { value: 'メモ' } });
    fireEvent.click(screen.getByRole('button', { name: '疑義の内容を保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('もう一度');
    expect(note).toHaveValue('メモ');
    expect(screen.getByText('不正解')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '疑義の内容を保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('再読み込み');
    expect(screen.getByRole('button', { name: '疑義の内容を保存' })).toBeDisabled();
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
