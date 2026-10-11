// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StructuredQuestion } from '@/features/questions/types';
import type { RecordQuestionAnswerResult } from './api';
import type { QuestionStudyCandidate, QuestionStudyStats } from './candidates';
import { StructuredQuestionStudyPage } from './StructuredQuestionStudyPage';

const base: StructuredQuestion = {
  id: 'q1', ownerId: 'o', materialId: 'm', keywordId: 'k',
  questionText: '光合成とは？', modelAnswer: '化学反応', choices: ['物理現象', '生物', '天体'], explanation: null,
  sortOrder: 0, isActive: true, doubtFlag: false, explanationRequestFlag: false,
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
  .mockResolvedValue({ kind: 'recorded', logId: 'l', stats })) {
  const load = vi.fn().mockResolvedValue(candidates);
  const onExit = vi.fn();
  render(<StructuredQuestionStudyPage initialScope={scope} onExit={onExit}
    loadCandidates={load} recordAnswer={record} />);
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

  it('選択肢は登録順（模範解答→登録選択肢）で並び、わからないは末尾に分かれる', async () => {
    setup([candidate(base)]);
    await start('選択式');
    const labels = screen.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent);
    expect(labels).toEqual(['化学反応', '物理現象', '生物', '天体', 'わからない']);
  });

  it('わからないは空の回答として記録され不正解になる', async () => {
    const { record } = setup([candidate(base)]);
    await start('選択式');
    fireEvent.click(screen.getByRole('radio', { name: 'わからない' }));
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByRole('status')).toHaveTextContent('不正解');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ answer: '', mode: 'choice' }));
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

  it('選択式はラベル付き選択肢で答え、不正解なら模範解答を示す', async () => {
    setup([candidate(base)]);
    await start('選択式');
    const group = screen.getByRole('radiogroup', { name: '選択肢' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解答する' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '物理現象' }));
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
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

  it('記録に失敗したらエラーを表示し件数を進めない', async () => {
    setup([candidate(base)], vi.fn().mockResolvedValue({ kind: 'failed', message: '回答を記録できませんでした' }));
    await start('記述式');
    fireEvent.change(screen.getByLabelText('解答'), { target: { value: '化学反応' } });
    fireEvent.click(screen.getByRole('button', { name: '解答する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('回答を記録できませんでした');
    expect(screen.getByText('0 / 1 問')).toBeInTheDocument();
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
