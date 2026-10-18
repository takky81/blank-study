// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// 環境変数のないCIでも読み込めるよう、Supabaseクライアントは差し替える（データ関数は各テストで注入する）。
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import type { StructuredQuestion } from '@/features/questions/types';
import type { RecordQuestionAnswerResult } from './api';
import type { QuestionStudyCandidate, QuestionStudyStats } from './candidates';
import { formatQuestionScore, StructuredQuestionStudyPage } from './StructuredQuestionStudyPage';

const base: StructuredQuestion = {
  id: 'q1', ownerId: 'o', materialId: 'm', keywordId: 'k',
  questionText: '光合成とは？', modelAnswer: '化学反応', choices: ['物理現象', '生物', '天体'], explanation: null,
  sortOrder: 0, isActive: true, doubtFlag: false, doubtNote: null, doubtReasons: [], explanationRequestFlag: false,
  version: 3, updatedAt: '2026-10-11T00:00:00Z',
};
const candidate = (question: StructuredQuestion): QuestionStudyCandidate => ({
  question, stats: null, subjectOrder: 0, materialOrder: 0, chapterOrder: 0,
  bodyOccurrenceIndex: 0, keywordOrder: 0, questionOrder: question.sortOrder,
});
const stats: QuestionStudyStats = {
  questionId: 'q1', askedCount: 1, correctCount: 1, consecutiveCorrect: 1, intervalDays: 1,
  easeFactor: 2.5, dueAt: null, updatedAt: '2026-10-11T00:00:00Z',
};
Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) });
const scope = { kind: 'material', id: 'm' } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(candidates: readonly QuestionStudyCandidate[], record = vi.fn<(...a: unknown[]) => Promise<RecordQuestionAnswerResult>>()
  .mockResolvedValue({ kind: 'recorded', logId: 'l', stats }), random: () => number = () => 0.999) {
  const load = vi.fn().mockResolvedValue(candidates);
  const onExit = vi.fn();
  render(<StructuredQuestionStudyPage initialScope={scope} onExit={onExit}
    loadCandidates={load} recordAnswer={record} random={random} />);
  return { load, record, onExit };
}

async function start(mode: '自動' | '選択式' | '記述式' = '記述式') {
  fireEvent.click(await screen.findByRole('radio', { name: mode }));
  fireEvent.click(screen.getByRole('button', { name: '学習を開始' }));
}

describe('StructuredQuestionStudyPage', () => {
  it('読み込み中と候補なしを区別して表示する', async () => {
    const pending = deferred<readonly QuestionStudyCandidate[]>();
    const load = vi.fn().mockReturnValue(pending.promise);
    render(<StructuredQuestionStudyPage initialScope={scope} onExit={vi.fn()} loadCandidates={load} recordAnswer={vi.fn()} />);
    expect(screen.getByText('読み込んでいます…')).toBeInTheDocument();
    pending.resolve([]);
    expect(await screen.findByText('この範囲に出題できる設問はありません')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(scope);
  });

  it('読み込み失敗をエラーとして表示する', async () => {
    const load = vi.fn().mockRejectedValue(new Error('x'));
    render(<StructuredQuestionStudyPage initialScope={scope} onExit={vi.fn()} loadCandidates={load} recordAnswer={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('設問を読み込めませんでした');
  });

  it('範囲が未指定なら科目→教材→章を選び、深い階層ほど範囲を絞って読み込む', async () => {
    const load = vi.fn().mockResolvedValue([candidate(base)]);
    const scopeOptions = {
      listSubjects: vi.fn().mockResolvedValue([{ id: 's1', label: '生物' }]),
      listMaterials: vi.fn().mockResolvedValue([{ id: 'm1', label: '教科書' }]),
      listChapters: vi.fn().mockResolvedValue([{ id: 'c1', label: '第1章' }]),
      listKeywords: vi.fn().mockResolvedValue([{ id: 'k1', label: '光合成' }]),
    };
    render(<StructuredQuestionStudyPage initialScope={null} onExit={vi.fn()} loadCandidates={load}
      recordAnswer={vi.fn()} scopeOptions={scopeOptions} />);
    expect(screen.getByText('出題範囲を選んでください')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'この範囲で設定する' });
    expect(confirm).toBeDisabled();
    fireEvent.change(await screen.findByLabelText('科目'), { target: { value: 's1' } });
    expect(confirm).toBeEnabled();
    fireEvent.change(await screen.findByLabelText('教材'), { target: { value: 'm1' } });
    expect(scopeOptions.listMaterials).toHaveBeenCalledWith('s1');
    fireEvent.change(await screen.findByLabelText('章'), { target: { value: 'c1' } });
    expect(await screen.findByLabelText('キーワード')).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(await screen.findByText('対象 1 問')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ kind: 'chapter', id: 'c1' });
  });

  it('回答候補は乱数でシャッフルされ、模範解答の位置が固定されず、わからないは末尾に分かれる', async () => {
    const labelsWith = async (r: number) => {
      cleanup();
      setup([candidate(base)], undefined, () => r);
      await start('選択式');
      const group = screen.getByRole('group', { name: '選択肢' });
      return within(group).getAllByRole('button').map((button) => button.textContent?.replace(/^\[\w+\] /, ''));
    };
    // Fisher–Yates: r=0 は毎回先頭と交換、r≒1 は交換なし。
    expect(await labelsWith(0)).toEqual(['物理現象', '生物', '天体', '化学反応', 'わからない']);
    expect(await labelsWith(0.999)).toEqual(['化学反応', '物理現象', '生物', '天体', 'わからない']);
  });

  it('PC版では選択肢に[1]〜と[0]わからないを表示し、数字キーで解答を確定する', async () => {
    const { record } = setup([candidate(base)], undefined, () => 0.999);
    await start('選択式');
    const buttons = within(screen.getByRole('group', { name: '選択肢' })).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['[1] 化学反応', '[2] 物理現象', '[3] 生物', '[4] 天体', '[0] わからない']);
    // 読み上げ名にはキー名を含めない
    expect(screen.getByRole('button', { name: '化学反応' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1' });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0]?.[0]).toMatchObject({ answer: '化学反応' });
  });

  it('長い選択肢でもカードからはみ出さないよう折り返す', async () => {
    setup([candidate(base)]);
    await start('選択式');
    const button = screen.getByRole('button', { name: '化学反応' });
    expect(button).toHaveClass('whitespace-normal', 'h-auto', 'min-w-0');
    expect(button.querySelector('span:last-child')).toHaveClass('[overflow-wrap:anywhere]');
  });

  it('PC版の0キーはわからないとして記録する', async () => {
    const { record } = setup([candidate(base)]);
    await start('選択式');
    fireEvent.keyDown(window, { key: '0' });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record.mock.calls[0]?.[0]).toMatchObject({ answer: '' });
  });

  it('わからないは空の回答として記録され不正解になる', async () => {
    const { record } = setup([candidate(base)]);
    await start('選択式');
    fireEvent.click(screen.getByRole('button', { name: 'わからない' }));
    expect(await screen.findByRole('status')).toHaveTextContent('不正解');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ answer: '', mode: 'choice' }));
  });

  it('解答画面に記録前、結果画面に記録後のこの問題の正答数 / 出題数 (正答率) を表示する', async () => {
    setup([candidate(base)]);
    await start('記述式');
    expect(screen.getByLabelText('この問題の成績')).toHaveTextContent('この問題 - / 0 (-%)');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByRole('button', { name: '次の問題へ' })).toBeInTheDocument();
    expect(screen.getByLabelText('この問題の成績')).toHaveTextContent('この問題 1 / 1 (100%)');
  });

  it('成績は x / x (x%) で正答率を四捨五入し、未出題は - / 0 (-%) とする', () => {
    expect(formatQuestionScore(null)).toBe('- / 0 (-%)');
    expect(formatQuestionScore({ askedCount: 0, correctCount: 0 })).toBe('- / 0 (-%)');
    expect(formatQuestionScore({ askedCount: 3, correctCount: 2 })).toBe('2 / 3 (67%)');
    expect(formatQuestionScore({ askedCount: 8, correctCount: 1 })).toBe('1 / 8 (13%)');
  });

  it('記述式で空回答は確定できず、正解を記録して判定と進行を表示する', async () => {
    const { record } = setup([candidate(base)]);
    await start('記述式');
    expect(screen.getByText('光合成とは？')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '解答する' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(submit);
    expect(await screen.findByRole('status')).toHaveTextContent('正解');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'q1', expectedQuestionVersion: 3, answer: '化学反応', mode: 'written',
    }));
    expect(screen.getByText('1 / 1 問')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次の問題へ' }));
    expect(await screen.findByText(/学習が終わりました/)).toBeInTheDocument();
    expect(screen.getByText('正解 1 / 1 問')).toBeInTheDocument();
  });

  it('選択式は選択肢を押した時点で解答を確定し、不正解なら模範解答を示す', async () => {
    const { record } = setup([candidate(base)]);
    await start('選択式');
    expect(screen.getByRole('group', { name: '選択肢' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解答する' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '物理現象' }));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ answer: '物理現象', mode: 'choice' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('不正解');
    expect(status).toHaveTextContent('化学反応');
  });

  it('記録中は同じ回答を再送信しない', async () => {
    const pending = deferred<RecordQuestionAnswerResult>();
    const record = vi.fn().mockReturnValue(pending.promise);
    setup([candidate(base)], record);
    await start('記述式');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    const submit = screen.getByRole('button', { name: '解答する' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(record).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: /記録しています/ })).toBeDisabled());
    pending.resolve({ kind: 'recorded', logId: 'l', stats });
    expect(await screen.findByRole('status')).toHaveTextContent('正解');
  });

  it('記録に失敗しても判定結果を保持し、未記録警告と再試行を示して次問へ進めない', async () => {
    setup([candidate(base), candidate({ ...base, id: 'q2', sortOrder: 1 })],
      vi.fn().mockResolvedValue({ kind: 'failed', message: '回答を記録できませんでした' }));
    await start('記述式');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未記録');
    expect(screen.getByRole('alert')).toHaveTextContent('回答を記録できませんでした');
    expect(screen.getByRole('status')).toHaveTextContent('正解');
    expect(screen.getByText('光合成とは？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '記録を再試行' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '次の問題へ' })).not.toBeInTheDocument();
    expect(screen.getByText('0 / 2 問')).toBeInTheDocument();
  });

  it('再試行は同じ入力を1回だけ送り、成功時だけ件数を1回進めて次問へ進める', async () => {
    const pending = deferred<RecordQuestionAnswerResult>();
    const record = vi.fn<(...a: unknown[]) => Promise<RecordQuestionAnswerResult>>()
      .mockResolvedValueOnce({ kind: 'failed', message: '回答を記録できませんでした' })
      .mockReturnValueOnce(pending.promise);
    setup([candidate(base), candidate({ ...base, id: 'q2', sortOrder: 1 })], record);
    await start('記述式');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    const retry = await screen.findByRole('button', { name: '記録を再試行' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1]?.[0]).toEqual(record.mock.calls[0]?.[0]);
    pending.resolve({ kind: 'recorded', logId: 'l', stats });
    fireEvent.click(await screen.findByRole('button', { name: '次の問題へ' }));
    expect(await screen.findByText('1 / 2 問')).toBeInTheDocument();
    expect(screen.queryByText('未記録')).not.toBeInTheDocument();
  });

  it('記録失敗のまま学習を終えると記録済みの件数だけで終了する', async () => {
    setup([candidate(base)], vi.fn().mockResolvedValue({ kind: 'failed', message: '回答を記録できませんでした' }));
    await start('記述式');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    await screen.findByRole('button', { name: '記録を再試行' });
    fireEvent.click(screen.getByRole('button', { name: '学習を終える' }));
    expect(await screen.findByText('正解 0 / 0 問')).toBeInTheDocument();
  });

  it('設問競合では現在設問を再読込し、新しい版で再回答できる', async () => {
    const record = vi.fn<(...a: unknown[]) => Promise<RecordQuestionAnswerResult>>()
      .mockResolvedValueOnce({ kind: 'question-conflict' })
      .mockResolvedValueOnce({ kind: 'recorded', logId: 'l', stats });
    const reloadQuestion = vi.fn().mockResolvedValue({ ...base, version: 4, questionText: '光合成とは何か？' });
    render(<StructuredQuestionStudyPage initialScope={scope} onExit={vi.fn()}
      loadCandidates={vi.fn().mockResolvedValue([candidate(base)])} recordAnswer={record} reloadQuestion={reloadQuestion} />);
    await start('記述式');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByText('光合成とは何か？')).toBeInTheDocument();
    expect(reloadQuestion).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1', version: 3 }));
    expect(screen.getByRole('alert')).toHaveTextContent('設問が更新されました');
    expect(screen.getByLabelText('解答')).toHaveValue('');
    expect(screen.getByText('0 / 1 問')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByRole('status')).toHaveTextContent('正解');
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1]?.[0]).toMatchObject({ questionId: 'q1', expectedQuestionVersion: 4 });
  });

  it('設問競合で再読込した設問が無効なら記録せずに飛ばす', async () => {
    const record = vi.fn<(...a: unknown[]) => Promise<RecordQuestionAnswerResult>>()
      .mockResolvedValueOnce({ kind: 'question-conflict' });
    const reloadQuestion = vi.fn().mockResolvedValue(null);
    render(<StructuredQuestionStudyPage initialScope={scope} onExit={vi.fn()}
      loadCandidates={vi.fn().mockResolvedValue([candidate(base), candidate({ ...base, id: 'q2', sortOrder: 1, questionText: '呼吸とは？' })])}
      recordAnswer={record} reloadQuestion={reloadQuestion} />);
    await start('記述式');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByText('呼吸とは？')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('出題できなくなった');
    expect(screen.getByText('0 / 1 問')).toBeInTheDocument();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('途中終了すると記録済みの件数で終了し、戻る操作でonExitを呼ぶ', async () => {
    const { onExit } = setup([candidate(base), candidate({ ...base, id: 'q2', sortOrder: 1 })]);
    await start('記述式');
    fireEvent.click(screen.getByRole('button', { name: '学習を終える' }));
    expect(await screen.findByText('正解 0 / 0 問')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(onExit).toHaveBeenCalled();
  });
  it('判定後の結果画面で解説と見直しフラグを扱い、flag失敗でも判定結果を保持する', async () => {
    const setFlags = vi.fn().mockRejectedValue(new Error('x'));
    const load = vi.fn().mockResolvedValue([candidate({ ...base, explanation: '光で糖を作る' })]);
    render(<StructuredQuestionStudyPage initialScope={scope} onExit={vi.fn()} loadCandidates={load}
      recordAnswer={vi.fn().mockResolvedValue({ kind: 'recorded', logId: 'l', stats })} setFlags={setFlags} />);
    await start('記述式');
    fireEvent.change(screen.getByRole('textbox', { name: '解答' }), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByText('光で糖を作る')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '解説の追加を希望する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('フラグを保存できませんでした');
    expect(setFlags).toHaveBeenCalledWith('q1', 3, { explanationRequestFlag: true });
    expect(screen.getByText('正解')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次の問題へ' })).toBeInTheDocument();
  });
});
