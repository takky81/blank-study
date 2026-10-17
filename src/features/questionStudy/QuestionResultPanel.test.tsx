// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 環境変数のないCIでも読み込めるよう、Supabaseクライアントは差し替える（データ関数は各テストで注入する）。
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import type { ConsumerFlagMutationResult, StructuredQuestion } from '@/features/questions/types';
import { QuestionResultPanel, type QuestionFlagSetter } from './QuestionResultPanel';

const question: StructuredQuestion = {
  id: 'q1', ownerId: 'o', materialId: 'm', keywordId: 'k',
  questionText: '光合成とは？', modelAnswer: '化学反応', choices: [], explanation: '光で糖を作る反応',
  sortOrder: 0, isActive: true, doubtFlag: false, doubtNote: null, doubtReasons: [], explanationRequestFlag: false,
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
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtReasons: ['answer_guessable'] }, 4))
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtReasons: ['answer_guessable'], explanationRequestFlag: true }, 5));
    const { onQuestionUpdated } = setup(setFlags);
    fireEvent.click(screen.getByRole('checkbox', { name: '内容に疑義がある' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '内容に疑義がある' })).toBeChecked());
    expect(setFlags).toHaveBeenLastCalledWith('q1', 3, { doubtFlag: true, doubtReasons: ['answer_guessable'] });
    // 疑義を付けると「知識がなくても解ける」が初期選択される
    expect(screen.getByRole('checkbox', { name: '知識がなくても解ける（問題文や選択肢から推測できる）' })).toBeChecked();
    // 見直しフラグは 解説の追加 → 疑義 の順に並ぶ
    expect(screen.getAllByRole('checkbox').slice(0, 2).map((c) => c.closest('label')?.textContent))
      .toEqual(['解説の追加を希望する', '内容に疑義がある']);
    expect(onQuestionUpdated).toHaveBeenLastCalledWith(expect.objectContaining({ version: 4, doubtFlag: true }));
    // 既存解説があっても解説追加を設定できる
    const request = screen.getByRole('checkbox', { name: '解説の追加を希望する' });
    expect(request).toBeEnabled();
    fireEvent.click(request);
    await waitFor(() => expect(request).toBeChecked());
    expect(setFlags).toHaveBeenLastCalledWith('q1', 4, { explanationRequestFlag: true });
    expect(screen.getByRole('checkbox', { name: '内容に疑義がある' })).toBeChecked();
  });

  it('疑義の内容は入力欄からフォーカスが外れたときに版付き契約で自動保存し、保存ボタンは出さない', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockResolvedValueOnce(saved({ doubtFlag: true }, 4))
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtNote: '答えが古い' }, 5));
    const { onQuestionUpdated } = setup(setFlags);
    expect(screen.queryByLabelText('疑義の内容（任意）')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '内容に疑義がある' }));
    const note = await screen.findByLabelText('疑義の内容（任意）');
    expect(note).toHaveValue('');
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument();
    fireEvent.change(note, { target: { value: '  答えが古い  ' } });
    expect(setFlags).toHaveBeenCalledTimes(1);
    fireEvent.blur(note);
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 4, { doubtFlag: true, doubtReasons: [], doubtNote: '答えが古い' }));
    await waitFor(() => expect(onQuestionUpdated).toHaveBeenLastCalledWith(expect.objectContaining({ version: 5, doubtNote: '答えが古い' })));
    expect(screen.getByText('疑義の理由・内容を保存しました')).toBeInTheDocument();
  });

  it('内容を変えずにフォーカスを外しても保存しない', () => {
    const setFlags = vi.fn<QuestionFlagSetter>();
    setup(setFlags, { doubtFlag: true, doubtNote: '既存メモ' });
    const note = screen.getByLabelText('疑義の内容（任意）');
    fireEvent.change(note, { target: { value: ' 既存メモ ' } });
    fireEvent.blur(note);
    expect(setFlags).not.toHaveBeenCalled();
  });

  it('既存の疑義内容を初期表示し、空にしてフォーカスを外すとnullを送り、解除で入力欄を隠す', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtNote: null }, 4))
      .mockResolvedValueOnce(saved({ doubtFlag: false, doubtNote: null }, 5));
    setup(setFlags, { doubtFlag: true, doubtNote: '既存メモ' });
    const note = screen.getByLabelText('疑義の内容（任意）');
    expect(note).toHaveValue('既存メモ');
    fireEvent.change(note, { target: { value: '   ' } });
    fireEvent.blur(note);
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 3, { doubtFlag: true, doubtReasons: [], doubtNote: null }));
    await waitFor(() => expect(screen.getByText('疑義の理由・内容を保存しました')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: '内容に疑義がある' }));
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 4, { doubtFlag: false }));
    await waitFor(() => expect(screen.queryByLabelText('疑義の内容（任意）')).not.toBeInTheDocument());
  });

  it('疑義の理由はチェックするたびに入力中の内容と一緒に正規順で保存する', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtReasons: ['answer_guessable', 'unclear'], doubtNote: 'メモ' }, 4))
      .mockResolvedValueOnce(saved({ doubtFlag: false, doubtReasons: [], doubtNote: null }, 5));
    const { onQuestionUpdated } = setup(setFlags, { doubtFlag: true, doubtReasons: ['unclear'] });
    expect(screen.getByRole('group', { name: '疑義の理由' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '問題文が分かりにくい' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '問う価値が低い' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '問題不備（正解・問題文の誤り、正解が一つに決まらない）' })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('疑義の内容（任意）'), { target: { value: 'メモ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '知識がなくても解ける（問題文や選択肢から推測できる）' }));
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 3,
      { doubtFlag: true, doubtReasons: ['answer_guessable', 'unclear'], doubtNote: 'メモ' }));
    await waitFor(() => expect(onQuestionUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 4, doubtReasons: ['answer_guessable', 'unclear'] })));
    fireEvent.click(screen.getByRole('checkbox', { name: '内容に疑義がある' }));
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 4, { doubtFlag: false }));
    await waitFor(() => expect(screen.queryByRole('group', { name: '疑義の理由' })).not.toBeInTheDocument());
  });

  it('保存中に続けて変更すると、完了後に最新の内容を新しい版で1回だけ送る', async () => {
    let release: (value: Awaited<ReturnType<QuestionFlagSetter>>) => void = () => {};
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockReturnValueOnce(new Promise((done) => { release = done; }))
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtReasons: ['low_value', 'unclear'] }, 5));
    setup(setFlags, { doubtFlag: true });
    fireEvent.click(screen.getByRole('checkbox', { name: '問う価値が低い' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '問題不備（正解・問題文の誤り、正解が一つに決まらない）' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '問題文が分かりにくい' }));
    expect(setFlags).toHaveBeenCalledTimes(1);
    release(saved({ doubtFlag: true, doubtReasons: ['low_value'] }, 4));
    await waitFor(() => expect(setFlags).toHaveBeenCalledTimes(2));
    expect(setFlags).toHaveBeenLastCalledWith('q1', 4,
      { doubtFlag: true, doubtReasons: ['low_value', 'defective', 'unclear'], doubtNote: null });
  });

  it('疑義の理由の保存失敗では選択を保持し、再保存で同じ内容を送る', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(saved({ doubtFlag: true, doubtReasons: ['low_value'] }, 4));
    setup(setFlags, { doubtFlag: true });
    fireEvent.click(screen.getByRole('checkbox', { name: '問う価値が低い' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('もう一度');
    expect(screen.getByRole('checkbox', { name: '問う価値が低い' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '再保存' }));
    await waitFor(() => expect(setFlags).toHaveBeenLastCalledWith('q1', 3,
      { doubtFlag: true, doubtReasons: ['low_value'], doubtNote: null }));
    await waitFor(() => expect(screen.getByText('疑義の理由・内容を保存しました')).toBeInTheDocument());
  });

  it('疑義内容の保存失敗では入力を保持し、競合では再読み込みを促して操作を止める', async () => {
    const setFlags = vi.fn<QuestionFlagSetter>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ kind: 'version-conflict', current: { ...question, version: 9 } });
    setup(setFlags, { doubtFlag: true });
    const note = screen.getByLabelText('疑義の内容（任意）');
    fireEvent.change(note, { target: { value: 'メモ' } });
    fireEvent.blur(note);
    expect(await screen.findByRole('alert')).toHaveTextContent('もう一度');
    expect(note).toHaveValue('メモ');
    expect(screen.getByText('不正解')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('再読み込み');
    expect(screen.getByLabelText('疑義の内容（任意）')).toBeDisabled();
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
