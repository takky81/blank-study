// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 環境変数のないCIでも読み込めるよう、Supabaseクライアントは差し替える（データ関数は各テストで注入する）。
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { QuestionBankPage, type QuestionBankApi } from './QuestionBankPage';
import type { DeleteQuestionResult, MutationResult, ReorderQuestionResult, StructuredQuestion } from './types';

const keyword = { id: 'keyword-1', materialId: 'material-1', label: '光合成' };
const question: StructuredQuestion = {
  id: 'question-1', ownerId: 'owner-1', materialId: 'material-1', keywordId: 'keyword-1',
  questionText: '光合成とは？', modelAnswer: '化学反応', choices: [], explanation: null,
  sortOrder: 0, isActive: true, doubtFlag: false, doubtNote: null, doubtReasons: [], explanationRequestFlag: false,
  version: 1, updatedAt: '2026-10-11T00:00:00Z',
};

function api(overrides: Partial<QuestionBankApi> = {}): QuestionBankApi {
  return {
    listQuestionsByKeyword: vi.fn().mockResolvedValue([]),
    saveQuestion: vi.fn(), setQuestionFlags: vi.fn(), setQuestionActive: vi.fn(),
    reorderQuestions: vi.fn(), deleteQuestion: vi.fn(), ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type OperationOutcome = MutationResult | ReorderQuestionResult | DeleteQuestionResult;
type OperationCase = {
  name: string;
  initial: readonly StructuredQuestion[];
  mutationKey: 'saveQuestion' | 'setQuestionFlags' | 'setQuestionActive' | 'reorderQuestions' | 'deleteQuestion';
  success: OperationOutcome;
  conflict: OperationOutcome;
  start: () => Promise<void>;
  acknowledgeEditorConflict?: () => Promise<void>;
};

const secondQuestion: StructuredQuestion = { ...question, id: 'question-2', questionText: '二問目', sortOrder: 1 };
const currentQuestion: StructuredQuestion = { ...question, questionText: 'サーバーの現在版', version: 9 };
const savedQuestion: StructuredQuestion = { ...question, questionText: '保存後', version: 2 };

const operationCases: readonly OperationCase[] = [
  {
    name: '保存', initial: [question], mutationKey: 'saveQuestion',
    success: { kind: 'saved', question: savedQuestion }, conflict: { kind: 'version-conflict', current: currentQuestion },
    start: async () => {
      fireEvent.click(await screen.findByRole('button', { name: '設問を編集' }));
      fireEvent.change(screen.getByLabelText('設問文'), { target: { value: '手元の編集' } });
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    },
    acknowledgeEditorConflict: async () => { fireEvent.click(await screen.findByRole('button', { name: /現在の版 9 .*確認/ })); },
  },
  {
    name: 'flag', initial: [{ ...question, doubtFlag: true }], mutationKey: 'setQuestionFlags',
    success: { kind: 'saved', question: { ...question, doubtFlag: false, version: 2 } }, conflict: { kind: 'version-conflict', current: currentQuestion },
    start: async () => { fireEvent.click(await screen.findByRole('button', { name: '疑義フラグを解除' })); },
  },
  {
    name: '有効状態', initial: [question], mutationKey: 'setQuestionActive',
    success: { kind: 'saved', question: { ...question, isActive: false, version: 2 } }, conflict: { kind: 'version-conflict', current: currentQuestion },
    start: async () => {
      fireEvent.click(await screen.findByRole('button', { name: '設問を無効にする' }));
      fireEvent.click(screen.getByRole('button', { name: '無効にする' }));
    },
  },
  {
    name: '並べ替え', initial: [question, secondQuestion], mutationKey: 'reorderQuestions',
    success: [{ ...secondQuestion, sortOrder: 0, version: 2 }, { ...question, sortOrder: 1, version: 2 }],
    conflict: { kind: 'version-conflict', current: currentQuestion },
    start: async () => { fireEvent.click((await screen.findAllByRole('button', { name: '下へ移動' }))[0]!); },
  },
  {
    name: '削除', initial: [question], mutationKey: 'deleteQuestion', success: 'deleted',
    conflict: { kind: 'version-conflict', current: currentQuestion },
    start: async () => {
      fireEvent.click(await screen.findByRole('button', { name: '設問を削除' }));
      fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    },
  },
];

function mutationApi(operation: OperationCase, mutation: ReturnType<typeof vi.fn>, list: ReturnType<typeof vi.fn>) {
  return api({ listQuestionsByKeyword: list, [operation.mutationKey]: mutation });
}

function questionsAfterSuccess(outcome: OperationOutcome): readonly StructuredQuestion[] {
  if (outcome === 'deleted') return [];
  if (!('kind' in outcome)) return outcome;
  if (outcome.kind === 'saved') return [outcome.question];
  throw new Error('success fixture must not be a version conflict');
}

describe('QuestionBankPage', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it('読み込み中と空状態を区別し、最初の作成導線を表示する', async () => {
    let resolve!: (value: StructuredQuestion[]) => void;
    const bankApi = api({ listQuestionsByKeyword: vi.fn(() => new Promise<StructuredQuestion[]>((done) => { resolve = done; })) });
    render(<QuestionBankPage materialId="material-1" keyword={keyword} api={bankApi} />);
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
    resolve([]);
    expect(await screen.findByText('このキーワードには設問がまだありません。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '最初の設問を作成' }));
    expect(screen.getByRole('form', { name: '設問編集' })).toBeInTheDocument();
  });

  it('取得失敗から同じkeywordを再試行する', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('設問の取得に失敗しました')).mockResolvedValueOnce([question]);
    render(<QuestionBankPage materialId="material-1" keyword={keyword} api={api({ listQuestionsByKeyword: list })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('設問の取得に失敗しました');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByText('光合成とは？')).toBeInTheDocument();
    expect(list).toHaveBeenNthCalledWith(2, 'keyword-1');
  });

  it('不明または教材不一致を同じnot-found表示にする', () => {
    const bankApi = api();
    const { rerender } = render(<QuestionBankPage materialId="material-1" keyword={null} api={bankApi} />);
    expect(screen.getByText('対象のキーワードを表示できません。')).toBeInTheDocument();
    rerender(<QuestionBankPage materialId="another-material" keyword={keyword} api={bankApi} />);
    expect(screen.getByText('対象のキーワードを表示できません。')).toBeInTheDocument();
    expect(bankApi.listQuestionsByKeyword).not.toHaveBeenCalled();
  });

  it('作成後に同じkeywordを再取得し、サーバー確定順を表示する', async () => {
    const saved = { ...question, id: 'question-2', questionText: '後の設問', sortOrder: 1 };
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([saved, question]);
    const save = vi.fn().mockResolvedValue({ kind: 'saved', question: saved });
    render(<QuestionBankPage materialId="material-1" keyword={keyword} api={api({ listQuestionsByKeyword: list, saveQuestion: save })} />);
    fireEvent.click(await screen.findByRole('button', { name: '最初の設問を作成' }));
    fireEvent.change(screen.getByLabelText('設問文'), { target: { value: '後の設問' } });
    fireEvent.change(screen.getByLabelText('模範解答'), { target: { value: '答え' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(list).toHaveBeenNthCalledWith(2, 'keyword-1'));
    const rows = await screen.findAllByRole('heading', { level: 3 });
    expect(rows.map((row) => row.textContent)).toEqual(['光合成とは？', '後の設問']);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ keywordId: 'keyword-1' }), undefined, undefined);
  });

  it('書込み成功後の再取得失敗は書込みを再送せず一覧だけ再取得する', async () => {
    const saved = { ...question, id: 'question-2', questionText: '保存済み' };
    const list = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('通信エラー')).mockResolvedValueOnce([saved]);
    const save = vi.fn().mockResolvedValue({ kind: 'saved', question: saved });
    render(<QuestionBankPage materialId="material-1" keyword={keyword} api={api({ listQuestionsByKeyword: list, saveQuestion: save })} />);
    fireEvent.click(await screen.findByRole('button', { name: '最初の設問を作成' }));
    fireEvent.change(screen.getByLabelText('設問文'), { target: { value: '保存済み' } });
    fireEvent.change(screen.getByLabelText('模範解答'), { target: { value: '答え' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('変更は保存されました');
    expect(screen.getByText('保存済み')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一覧を再取得' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keyword変更前の遅い読取結果を破棄する', async () => {
    const first = deferred<StructuredQuestion[]>();
    const secondQuestion = { ...question, id: 'question-2', keywordId: 'keyword-2', questionText: '新しい文脈' };
    const list = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce([secondQuestion]);
    const bankApi = api({ listQuestionsByKeyword: list });
    const { rerender } = render(<QuestionBankPage materialId="material-1" keyword={keyword} api={bankApi} />);
    rerender(<QuestionBankPage materialId="material-1" keyword={{ id: 'keyword-2', materialId: 'material-1', label: '新' }} api={bankApi} />);
    expect(await screen.findByText('新しい文脈')).toBeInTheDocument();
    first.resolve([question]);
    await waitFor(() => expect(screen.queryByText('光合成とは？')).not.toBeInTheDocument());
  });

  it('keyword変更前のmutation成功で新しい文脈を更新・再取得しない', async () => {
    const mutation = deferred<{ kind: 'saved'; question: StructuredQuestion }>();
    const changed = { ...question, isActive: false, version: 2 };
    const next = { ...question, id: 'question-2', keywordId: 'keyword-2', questionText: '新しい設問' };
    const list = vi.fn().mockResolvedValueOnce([question]).mockResolvedValueOnce([next]);
    const setActive = vi.fn().mockReturnValue(mutation.promise);
    const bankApi = api({ listQuestionsByKeyword: list, setQuestionActive: setActive });
    const { rerender } = render(<QuestionBankPage materialId="material-1" keyword={keyword} api={bankApi} />);
    fireEvent.click(await screen.findByRole('button', { name: '設問を無効にする' }));
    fireEvent.click(screen.getByRole('button', { name: '無効にする' }));
    rerender(<QuestionBankPage materialId="material-1" keyword={{ id: 'keyword-2', materialId: 'material-1', label: '新' }} api={bankApi} />);
    expect(await screen.findByText('新しい設問')).toBeInTheDocument();
    mutation.resolve({ kind: 'saved', question: changed });
    await waitFor(() => expect(setActive).toHaveBeenCalledTimes(1));
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('光合成とは？')).not.toBeInTheDocument();
  });

  it('アンマウント後の読取完了でstate更新しない', async () => {
    const pending = deferred<StructuredQuestion[]>();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(<QuestionBankPage materialId="material-1" keyword={keyword} api={api({ listQuestionsByKeyword: vi.fn().mockReturnValue(pending.promise) })} />);
    unmount(); pending.resolve([question]);
    await Promise.resolve(); await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('編集競合時はdraftを保持し、明示的な確認後に現在版を再読込する', async () => {
    const current = { ...question, questionText: 'サーバー版', version: 2 };
    const list = vi.fn().mockResolvedValueOnce([question]).mockResolvedValueOnce([current]);
    const save = vi.fn().mockResolvedValue({ kind: 'version-conflict', current });
    render(<QuestionBankPage materialId="material-1" keyword={keyword} api={api({ listQuestionsByKeyword: list, saveQuestion: save })} />);
    fireEvent.click(await screen.findByRole('button', { name: '設問を編集' }));
    fireEvent.change(screen.getByLabelText('設問文'), { target: { value: '手元のdraft' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.click(await screen.findByRole('button', { name: /現在の版 2 .*確認/ }));
    expect(screen.getByDisplayValue('手元のdraft')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '現在の版を再読込' }));
    expect(await screen.findByText('サーバー版')).toBeInTheDocument();
  });

  it('フラグ・有効状態・並べ替え・削除をAPIへ配線し、各成功後に同じkeywordを再取得する', async () => {
    const flagged = { ...question, doubtFlag: true };
    const other = { ...question, id: 'question-2', questionText: '二問目', sortOrder: 1 };
    const clear = { ...flagged, doubtFlag: false, version: 2 };
    const inactive = { ...clear, isActive: false, version: 3 };
    const reordered = [{ ...other, sortOrder: 0, version: 2 }, { ...inactive, sortOrder: 1, version: 4 }];
    const list = vi.fn()
      .mockResolvedValueOnce([flagged, other]).mockResolvedValueOnce([clear, other])
      .mockResolvedValueOnce([inactive, other]).mockResolvedValueOnce(reordered)
      .mockResolvedValueOnce([reordered[0]!]);
    const flags = vi.fn().mockResolvedValue({ kind: 'saved', question: clear });
    const active = vi.fn().mockResolvedValue({ kind: 'saved', question: inactive });
    const reorder = vi.fn().mockResolvedValue(reordered);
    const remove = vi.fn().mockResolvedValue('deleted');
    render(<QuestionBankPage materialId="material-1" keyword={keyword} api={api({ listQuestionsByKeyword: list, setQuestionFlags: flags, setQuestionActive: active, reorderQuestions: reorder, deleteQuestion: remove })} />);

    fireEvent.click(await screen.findByRole('button', { name: '疑義フラグを解除' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(flags).toHaveBeenCalledWith('question-1', 1, { doubtFlag: false });
    fireEvent.click(screen.getAllByRole('button', { name: '設問を無効にする' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '無効にする' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(active).toHaveBeenCalledWith('question-1', 2, false);
    fireEvent.click(screen.getAllByRole('button', { name: '下へ移動' })[0]!);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(4));
    expect(reorder).toHaveBeenCalledWith('keyword-1', expect.any(Array));
    fireEvent.click(screen.getAllByRole('button', { name: '設問を削除' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(5));
    expect(remove).toHaveBeenCalledWith('question-1', 4);
  });

  describe.each(operationCases)('$name の文脈分離', (operation) => {
    it.each(['success', 'version-conflict', 'rejection'] as const)('keyword切替後の遅い %s は新文脈を変更・再取得しない', async (outcome) => {
      const pending = deferred<OperationOutcome>();
      const next = { ...secondQuestion, keywordId: 'keyword-2', questionText: '新しい文脈の設問' };
      const list = vi.fn().mockResolvedValueOnce(operation.initial).mockResolvedValueOnce([next]);
      const mutation = vi.fn().mockReturnValue(pending.promise);
      const bankApi = mutationApi(operation, mutation, list);
      const { rerender } = render(<QuestionBankPage materialId="material-1" keyword={keyword} api={bankApi} />);
      await operation.start();
      rerender(<QuestionBankPage materialId="material-1" keyword={{ id: 'keyword-2', materialId: 'material-1', label: '新' }} api={bankApi} />);
      expect(await screen.findByText('新しい文脈の設問')).toBeInTheDocument();

      if (outcome === 'rejection') pending.reject(new Error('古い操作の失敗'));
      else pending.resolve(outcome === 'success' ? operation.success : operation.conflict);

      await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      expect(list).toHaveBeenCalledTimes(2);
      expect(screen.getByText('新しい文脈の設問')).toBeInTheDocument();
      expect(screen.queryByText(/古い操作の失敗|サーバー上の現在の版|保存しました|削除しました|並べ替えました/)).not.toBeInTheDocument();
    });

    it.each(['resolve', 'reject'] as const)('アンマウント後の %s を黙って破棄する', async (settlement) => {
      const pending = deferred<OperationOutcome>();
      const mutation = vi.fn().mockReturnValue(pending.promise);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const unhandled = vi.fn();
      window.addEventListener('unhandledrejection', unhandled);
      const { unmount } = render(<QuestionBankPage materialId="material-1" keyword={keyword} api={mutationApi(operation, mutation, vi.fn().mockResolvedValue(operation.initial))} />);
      await operation.start();
      unmount();
      if (settlement === 'resolve') pending.resolve(operation.success);
      else pending.reject(new Error('アンマウント後の失敗'));
      await Promise.resolve(); await Promise.resolve();
      expect(error).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
      window.removeEventListener('unhandledrejection', unhandled);
      error.mockRestore();
    });

    it('現文脈の失敗を表示し、同じ操作だけを再試行して成功する', async () => {
      const mutation = vi.fn().mockRejectedValueOnce(new Error(`${operation.name}に失敗しました`)).mockResolvedValueOnce(operation.success);
      const confirmed = questionsAfterSuccess(operation.success);
      const list = vi.fn().mockResolvedValueOnce(operation.initial).mockResolvedValueOnce(confirmed);
      render(<QuestionBankPage materialId="material-1" keyword={keyword} api={mutationApi(operation, mutation, list)} />);
      await operation.start();
      expect(await screen.findByRole('alert')).toHaveTextContent(`${operation.name}に失敗しました`);
      fireEvent.click(screen.getByRole('button', { name: '再試行' }));
      await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    });

    it('現文脈の競合はmutationを再送せず、明示操作で現在版を再読込する', async () => {
      const mutation = vi.fn().mockResolvedValue(operation.conflict);
      const list = vi.fn().mockResolvedValueOnce(operation.initial).mockResolvedValueOnce([currentQuestion]);
      render(<QuestionBankPage materialId="material-1" keyword={keyword} api={mutationApi(operation, mutation, list)} />);
      await operation.start();
      if (operation.acknowledgeEditorConflict) await operation.acknowledgeEditorConflict();
      expect(await screen.findByRole('button', { name: '現在の版を再読込' })).toBeInTheDocument();
      expect(mutation).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: '現在の版を再読込' }));
      expect(await screen.findByText('サーバーの現在版')).toBeInTheDocument();
      expect(list).toHaveBeenCalledTimes(2);
      expect(mutation).toHaveBeenCalledTimes(1);
    });
  });
});
