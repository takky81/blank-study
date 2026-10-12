import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { QuestionEditor } from './QuestionEditor';
import { QuestionBankOperationCancelled } from './operationCancellation';
import type { MutationResult, QuestionContentDraft, StructuredQuestion } from './types';

const initialDraft: QuestionContentDraft = {
  questionText: '  日本の首都は？  ',
  modelAnswer: '  東京  ',
  choices: ['大阪', '京都'],
  explanation: '  東京都に政府機関があります。  ',
};

function savedQuestion(version: number): StructuredQuestion {
  return {
    id: 'question-1',
    ownerId: 'owner-1',
    materialId: 'material-1',
    keywordId: 'keyword-1',
    questionText: '日本の首都は？',
    modelAnswer: '東京',
    choices: ['大阪', '京都'],
    explanation: '東京都に政府機関があります。',
    sortOrder: 0,
    isActive: true,
    doubtFlag: false,
    doubtNote: null, doubtReasons: [], explanationRequestFlag: false,
    version,
    updatedAt: '2026-10-11T00:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pressKeyboardButton(button: HTMLElement, key: 'Enter' | ' ') {
  button.focus();
  fireEvent.keyDown(button, { key });
  fireEvent.keyUp(button, { key });
  // jsdom does not synthesize the browser's click following keyboard activation.
  fireEvent.click(button);
}

describe('QuestionEditor', () => {
  it('ラベル付きの全項目を初期draftから表示する', () => {
    render(
      <QuestionEditor initialDraft={initialDraft} onSave={vi.fn()} onCancel={vi.fn()} onReloadConflict={vi.fn()} />,
    );

    expect(screen.getByLabelText('設問文')).toHaveValue(initialDraft.questionText);
    expect(screen.getByLabelText('模範解答')).toHaveValue(initialDraft.modelAnswer);
    expect(screen.getByLabelText('選択肢1')).toHaveValue('大阪');
    expect(screen.getByLabelText('選択肢2')).toHaveValue('京都');
    expect(screen.getByLabelText('解説（任意）')).toHaveValue(initialDraft.explanation);
  });

  it('field errorを該当入力へ関連付け、無効なdraftを保存しない', () => {
    const onSave = vi.fn();
    render(
      <QuestionEditor
        initialDraft={{ questionText: '', modelAnswer: '', choices: ['', ''], explanation: null }}
        onSave={onSave}
        onCancel={vi.fn()}
        onReloadConflict={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const question = screen.getByLabelText('設問文');
    const firstChoice = screen.getByLabelText('選択肢1');
    expect(question).toHaveAttribute('aria-invalid', 'true');
    expect(question).toHaveAttribute('aria-describedby', 'question-editor-questionText-error');
    expect(document.getElementById('question-editor-questionText-error')).toHaveTextContent(
      '設問文を入力してください。',
    );
    expect(firstChoice).toHaveAttribute('aria-describedby', 'question-editor-choice-0-error');
    expect(document.getElementById('question-editor-choice-0-error')).toHaveTextContent(
      '選択肢1を入力してください。',
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('選択肢を追加・削除・上下移動し、表示順で正規化draftを保存する', async () => {
    const onSave = vi.fn<(draft: QuestionContentDraft) => Promise<MutationResult>>();
    onSave.mockResolvedValue({ kind: 'saved', question: savedQuestion(4) });
    render(
      <QuestionEditor initialDraft={initialDraft} onSave={onSave} onCancel={vi.fn()} onReloadConflict={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '選択肢を追加' }));
    fireEvent.change(screen.getByLabelText('選択肢3'), { target: { value: '  名古屋  ' } });
    fireEvent.click(screen.getByRole('button', { name: '選択肢3を上へ移動' }));
    fireEvent.click(screen.getByRole('button', { name: '選択肢1を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await screen.findByText('保存しました（版 4）');
    expect(onSave).toHaveBeenCalledWith({
      questionText: '日本の首都は？',
      modelAnswer: '東京',
      choices: ['名古屋', '京都'],
      explanation: '東京都に政府機関があります。',
    });
  });

  it('保存中は再送信を抑止し、確定版を成功通知する', async () => {
    const pending = deferred<MutationResult>();
    const onSave = vi.fn(() => pending.promise);
    render(
      <QuestionEditor initialDraft={initialDraft} onSave={onSave} onCancel={vi.fn()} onReloadConflict={vi.fn()} />,
    );

    const save = screen.getByRole('button', { name: '保存' });
    fireEvent.click(save);
    fireEvent.submit(save.closest('form')!);

    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    expect(screen.getByLabelText('設問文')).toBeDisabled();
    expect(screen.getByLabelText('模範解答')).toBeDisabled();
    expect(screen.getByLabelText('選択肢1')).toBeDisabled();
    expect(screen.getByLabelText('解説（任意）')).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ kind: 'saved', question: savedQuestion(7) }));
    expect(screen.getByRole('status')).toHaveTextContent('保存しました（版 7）');
  });

  it('保存失敗後も入力を保持し、再試行できる', async () => {
    const onSave = vi
      .fn<(draft: QuestionContentDraft) => Promise<MutationResult>>()
      .mockRejectedValueOnce(new Error('設問の保存に失敗しました。'))
      .mockResolvedValueOnce({ kind: 'saved', question: savedQuestion(9) });
    render(
      <QuestionEditor initialDraft={initialDraft} onSave={onSave} onCancel={vi.fn()} onReloadConflict={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('設問文'), { target: { value: '変更中の設問' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('設問の保存に失敗しました。');
    expect(screen.getByLabelText('設問文')).toHaveValue('変更中の設問');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    await screen.findByText('保存しました（版 9）');
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('版競合では自動上書きや再送信をせず、入力を保持して現在版の確認を提示する', async () => {
    const onReloadConflict = vi.fn();
    const onSave = vi.fn().mockResolvedValue({
      kind: 'version-conflict',
      current: savedQuestion(11),
    } satisfies MutationResult);
    render(
      <QuestionEditor initialDraft={initialDraft} onSave={onSave} onCancel={vi.fn()} onReloadConflict={onReloadConflict} />,
    );
    fireEvent.change(screen.getByLabelText('模範解答'), { target: { value: '変更中の答え' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('現在の版は 11 です');
    expect(screen.getByLabelText('模範解答')).toHaveValue('変更中の答え');
    expect(screen.queryByRole('button', { name: '再試行' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '現在の版 11 を再読込して確認' }));
    expect(onReloadConflict).toHaveBeenCalledWith(savedQuestion(11));
  });

  it('選択肢操作・保存・キャンセルを通常のキーボード到達可能なbuttonで提供する', () => {
    const onCancel = vi.fn();
    render(
      <QuestionEditor initialDraft={initialDraft} onSave={vi.fn()} onCancel={onCancel} onReloadConflict={vi.fn()} />,
    );

    const form = screen.getByRole('form', { name: '設問編集' });
    const buttons = within(form).getAllByRole('button');
    expect(buttons.every((button) => button.tagName === 'BUTTON' && button.tabIndex === 0)).toBe(true);
    pressKeyboardButton(screen.getByRole('button', { name: 'キャンセル' }), 'Enter');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('追加・削除・並べ替え後に論理的な入力へfocusを移し、操作buttonはsubmitしない', () => {
    const onSave = vi.fn();
    render(<QuestionEditor initialDraft={initialDraft} onSave={onSave} onCancel={vi.fn()} onReloadConflict={vi.fn()} />);

    pressKeyboardButton(screen.getByRole('button', { name: '選択肢を追加' }), 'Enter');
    expect(screen.getByLabelText('選択肢3')).toHaveFocus();

    pressKeyboardButton(screen.getByRole('button', { name: '選択肢3を上へ移動' }), ' ');
    expect(screen.getByLabelText('選択肢2')).toHaveFocus();

    pressKeyboardButton(screen.getByRole('button', { name: '選択肢2を削除' }), 'Enter');
    expect(screen.getByLabelText('選択肢2')).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('入力変更時に対応するfield errorだけを解除する', () => {
    render(<QuestionEditor initialDraft={{ questionText: '', modelAnswer: '', choices: [''], explanation: null }} onSave={vi.fn()} onCancel={vi.fn()} onReloadConflict={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    fireEvent.change(screen.getByLabelText('設問文'), { target: { value: '問い' } });
    expect(screen.getByLabelText('設問文')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('設問文')).not.toHaveAttribute('aria-describedby');
    expect(screen.getByLabelText('模範解答')).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByLabelText('選択肢1'), { target: { value: '候補' } });
    expect(screen.getByLabelText('選択肢1')).not.toHaveAttribute('aria-invalid');
    expect(document.getElementById('question-editor-choice-0-error')).not.toBeInTheDocument();
  });

  it('保存をEnter、キャンセルをSpaceでキーボード実行できる', async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: 'saved', question: savedQuestion(12) } satisfies MutationResult);
    const onCancel = vi.fn();
    render(<QuestionEditor initialDraft={initialDraft} onSave={onSave} onCancel={onCancel} onReloadConflict={vi.fn()} />);

    pressKeyboardButton(screen.getByRole('button', { name: '保存' }), 'Enter');
    await screen.findByText('保存しました（版 12）');
    pressKeyboardButton(screen.getByRole('button', { name: 'キャンセル' }), ' ');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('文脈キャンセルとunmount後の成功・競合・失敗を通知しない', async () => {
    const pending = deferred<MutationResult>();
    const reload = vi.fn();
    const { unmount } = render(<QuestionEditor initialDraft={initialDraft} onSave={() => pending.promise} onCancel={vi.fn()} onReloadConflict={reload} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    unmount();
    await act(async () => pending.resolve({ kind: 'version-conflict', current: savedQuestion(20) }));
    expect(reload).not.toHaveBeenCalled();

    const cancelled = vi.fn().mockRejectedValue(new QuestionBankOperationCancelled());
    render(<QuestionEditor initialDraft={initialDraft} onSave={cancelled} onCancel={vi.fn()} onReloadConflict={reload} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await act(async () => undefined);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
