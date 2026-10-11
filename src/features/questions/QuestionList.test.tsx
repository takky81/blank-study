import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { QuestionList } from './QuestionList';
import type { MutationResult, StructuredQuestion } from './types';

function question(overrides: Partial<StructuredQuestion> = {}): StructuredQuestion {
  return {
    id: 'question-1', ownerId: 'owner-1', materialId: 'material-1', keywordId: 'keyword-1',
    questionText: '日本の首都は？', modelAnswer: '東京', choices: ['大阪'],
    explanation: null, sortOrder: 0, isActive: true, doubtFlag: false,
    explanationRequestFlag: false, version: 1, updatedAt: '2026-10-11T00:00:00Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderList(overrides: Partial<ComponentProps<typeof QuestionList>> = {}) {
  const props: ComponentProps<typeof QuestionList> = {
    questions: [question()], onEdit: vi.fn(), onReorder: vi.fn(), onSetActive: vi.fn(),
    onClearFlag: vi.fn(), onDelete: vi.fn(), onVersionConflict: vi.fn(), ...overrides,
  };
  return { ...render(<QuestionList {...props} />), props };
}

describe('QuestionList', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('安定順で設問・状態・解説有無・各flag名と状態を表示する', () => {
    renderList({ questions: [
      question({ id: 'b', sortOrder: 1, questionText: '2番', isActive: false, explanation: '解説', doubtFlag: true }),
      question({ id: 'c', sortOrder: 0, questionText: '同順C', explanationRequestFlag: true }),
      question({ id: 'a', sortOrder: 0, questionText: '同順A' }),
    ] });
    expect(screen.getAllByRole('listitem').map((row) => within(row).getByRole('heading').textContent))
      .toEqual(['同順A', '同順C', '2番']);
    const row = screen.getAllByRole('listitem')[2]!;
    expect(row).toHaveTextContent('状態: 無効');
    expect(row).toHaveTextContent('解説: あり');
    expect(row).toHaveTextContent('疑義フラグ: あり');
    expect(row).toHaveTextContent('解説追加フラグ: なし');
  });

  it('編集、並べ替え、flag解除を共通行操作から実行して結果を通知する', async () => {
    const first = question({ id: 'a', sortOrder: 0, doubtFlag: true, explanationRequestFlag: true });
    const second = question({ id: 'b', sortOrder: 1, questionText: '二問目', version: 3 });
    const onEdit = vi.fn();
    const onReorder = vi.fn().mockResolvedValue([second, first]);
    const onClearFlag = vi.fn().mockResolvedValue({ kind: 'saved', question: { ...first, doubtFlag: false, version: 2 } } satisfies MutationResult);
    renderList({ questions: [first, second], onEdit, onReorder, onClearFlag });
    const firstRow = screen.getAllByRole('listitem')[0]!;
    fireEvent.click(within(firstRow).getByRole('button', { name: '設問を編集' }));
    expect(onEdit).toHaveBeenCalledWith(first);
    fireEvent.click(within(firstRow).getByRole('button', { name: '下へ移動' }));
    expect(onReorder).toHaveBeenCalledWith([{ id: 'b', version: 3, updatedAt: second.updatedAt }, { id: 'a', version: 1, updatedAt: first.updatedAt }]);
    expect(await screen.findByRole('status')).toHaveTextContent('並べ替えました');
    fireEvent.click(within(firstRow).getByRole('button', { name: '疑義フラグを解除' }));
    expect(onClearFlag).toHaveBeenCalledWith(first, 'doubtFlag');
    expect(await screen.findByRole('status')).toHaveTextContent('疑義フラグを解除しました');
  });

  it('有効状態変更と削除は対象を示す確認後だけ実行し、取消時は何もしない', async () => {
    const onSetActive = vi.fn().mockResolvedValue({ kind: 'saved', question: question({ isActive: false, version: 2 }) });
    const onDelete = vi.fn().mockResolvedValue('deleted');
    renderList({ onSetActive, onDelete });
    fireEvent.click(screen.getByRole('button', { name: '設問を無効にする' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('日本の首都は？');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onSetActive).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '設問を無効にする' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '設問を無効にする' }));
    fireEvent.click(screen.getByRole('button', { name: '無効にする' }));
    expect(onSetActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'question-1' }), false);
    expect(await screen.findByRole('status')).toHaveTextContent('設問を無効にしました');
    fireEvent.click(screen.getByRole('button', { name: '設問を削除' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('この操作は取り消せません');
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'question-1' }));
    expect(await screen.findByRole('status')).toHaveTextContent('設問を削除しました');
  });

  it('操作中の連打を防ぎ、失敗をalertで再試行できる', async () => {
    const pending = deferred<MutationResult>();
    const onClearFlag = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockRejectedValueOnce(new Error('設問のフラグ更新に失敗しました'))
      .mockResolvedValueOnce({ kind: 'saved', question: question({ doubtFlag: false, version: 2 }) });
    renderList({ questions: [question({ doubtFlag: true })], onClearFlag });
    const clear = screen.getByRole('button', { name: '疑義フラグを解除' });
    fireEvent.click(clear); fireEvent.click(clear);
    expect(onClearFlag).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ kind: 'saved', question: question({ doubtFlag: false, version: 2 }) }));
    fireEvent.click(clear);
    expect(await screen.findByRole('alert')).toHaveTextContent('設問のフラグ更新に失敗しました');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(onClearFlag).toHaveBeenCalledTimes(3);
    expect(await screen.findByRole('status')).toHaveTextContent('疑義フラグを解除しました');
  });

  it('版競合を現在版付きで通知し親へ渡す', async () => {
    const current = question({ version: 8 });
    const onVersionConflict = vi.fn();
    renderList({ questions: [question({ doubtFlag: true })], onClearFlag: vi.fn().mockResolvedValue({ kind: 'version-conflict', current }), onVersionConflict });
    fireEvent.click(screen.getByRole('button', { name: '疑義フラグを解除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('現在の版は 8');
    expect(onVersionConflict).toHaveBeenCalledWith(current);
  });

  it('狭幅では主要な編集操作を残し、他の操作を横スクロール不要のメニューへ畳む', () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const { container } = renderList({ questions: [question({ doubtFlag: true })] });

    expect(screen.getByRole('button', { name: '設問を編集' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '疑義フラグを解除' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '「日本の首都は？」のその他の操作' }));
    expect(screen.getByRole('button', { name: '疑義フラグを解除' })).toBeVisible();
    expect(container.querySelector('li')).toHaveClass('min-w-0');
    expect(container.querySelector('li')).not.toHaveClass('overflow-hidden');
  });
});
