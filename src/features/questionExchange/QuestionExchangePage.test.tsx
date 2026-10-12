// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StructuredQuestion } from '@/features/questions/types';
import type { EligibilityExportResult } from './api';
import type { ImportPreview } from './preview';
import { QuestionExchangePage, type QuestionExchangePageProps } from './QuestionExchangePage';
import type { QuestionExchangeExportV1 } from './types';

const filters = { minimumAttempts: 3, maximumAccuracy: 0.6, maximumQuestionCount: 5 };
const exportValue = { schemaVersion: 1, exchangeId: 'x', exportedAt: '2026-10-11T00:00:00.000Z', filters, targets: [] } as unknown as QuestionExchangeExportV1;
const current: StructuredQuestion = {
  id: 'q1', ownerId: 'o', materialId: 'm', keywordId: 'k1', questionText: '旧い問い', modelAnswer: '旧答', choices: ['誤'],
  explanation: null, sortOrder: 0, isActive: true, doubtFlag: true, doubtNote: null, explanationRequestFlag: false, version: 2, updatedAt: '',
};
const draft = { questionText: '新しい問い', modelAnswer: '新答', choices: ['誤'], explanation: null };
const okPreview: ImportPreview = {
  canCommit: true,
  items: [
    { kind: 'create', operationIndex: 0, keywordId: 'k1', draft },
    { kind: 'update', operationIndex: 1, keywordId: 'k1', before: current, after: draft },
  ],
};
const ngPreview: ImportPreview = {
  canCommit: false,
  items: [
    { kind: 'conflict', operationIndex: 0, current, incoming: { kind: 'create', keywordId: 'k1', question: draft } },
    { kind: 'error', operationIndex: null, path: '$.operations[1].question.questionText', message: '設問文が空です' },
  ],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<QuestionExchangePageProps> = {}) {
  const props = {
    exportEligible: vi.fn<QuestionExchangePageProps['exportEligible'] & object>()
      .mockResolvedValue({ kind: 'export', value: exportValue } as EligibilityExportResult),
    download: vi.fn().mockReturnValue({ kind: 'downloaded', fileName: 'question-exchange-1.json' }),
    previewImport: vi.fn().mockResolvedValue(okPreview),
    ...overrides,
  } as QuestionExchangePageProps & { exportEligible: ReturnType<typeof vi.fn>; download: ReturnType<typeof vi.fn>; previewImport: ReturnType<typeof vi.fn> };
  render(<QuestionExchangePage {...props} />);
  return props;
}

function fillFilters(a = '3', b = '0.6', c = '5') {
  fireEvent.change(screen.getByLabelText('最低出題回数'), { target: { value: a } });
  fireEvent.change(screen.getByLabelText('最大正答率'), { target: { value: b } });
  fireEvent.change(screen.getByLabelText('最大設問数'), { target: { value: c } });
}

const file = new File(['{}'], 'return.json', { type: 'application/json' });
function chooseFile(f: File = file) {
  fireEvent.change(screen.getByLabelText('返却ファイル（JSON）'), { target: { files: [f] } });
}

describe('QuestionExchangePage 出力', () => {
  it('不正な閾値では抽出せず該当入力にerrorを関連付ける', async () => {
    const p = setup();
    fillFilters('', '2', 'abc');
    fireEvent.click(screen.getByRole('button', { name: '対象を出力' }));
    expect(p.exportEligible).not.toHaveBeenCalled();
    const input = screen.getByLabelText('最大正答率');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/0以上1以下/);
    expect(screen.getByLabelText('最低出題回数')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('最大設問数')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByLabelText('最低出題回数')).toHaveFocus());
  });

  it('有効な閾値で抽出しdownloadした結果をstatusで示す', async () => {
    const p = setup();
    fillFilters();
    fireEvent.click(screen.getByRole('button', { name: '対象を出力' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('question-exchange-1.json'));
    expect(p.exportEligible).toHaveBeenCalledWith(filters);
    expect(p.download).toHaveBeenCalledWith({ kind: 'export', value: exportValue });
  });

  it('対象0件ではdownloadせず対象なしを示す', async () => {
    const p = setup({ exportEligible: vi.fn().mockResolvedValue({ kind: 'empty', filters }) });
    fillFilters();
    fireEvent.click(screen.getByRole('button', { name: '対象を出力' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('条件に該当する対象はありません'));
    expect(p.download).not.toHaveBeenCalled();
  });

  it('出力中は二重実行せず、失敗時は文脈付きalertから再試行できる', async () => {
    const d = deferred<EligibilityExportResult>();
    const exportEligible = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue({ kind: 'empty', filters });
    setup({ exportEligible });
    fillFilters();
    const button = screen.getByRole('button', { name: '対象を出力' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(exportEligible).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('対象を抽出中…')).toBeInTheDocument();
    d.reject(new Error('設問交換の抽出に失敗しました: timeout'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('設問交換の抽出に失敗しました: timeout');
    fireEvent.click(within(alert).getByRole('button', { name: '出力を再試行' }));
    await waitFor(() => expect(exportEligible).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('最低出題回数')).toHaveValue(3);
  });
});

describe('QuestionExchangePage 取込preview', () => {
  it('fileを選択して区分別件数と内容をpreviewし、既定のcommit gatewayで確定可能になる', async () => {
    const p = setup();
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'previewを作成' }));
    const region = await screen.findByRole('region', { name: '取込preview' });
    expect(p.previewImport).toHaveBeenCalledWith(file);
    expect(within(region).getByText('新規 1件')).toBeInTheDocument();
    expect(within(region).getByText('更新 1件')).toBeInTheDocument();
    expect(within(region).getByText('競合 0件')).toBeInTheDocument();
    expect(within(region).getByText('エラー 0件')).toBeInTheDocument();
    expect(within(region).getByText('旧い問い')).toBeInTheDocument();
    expect(within(region).getAllByText('新しい問い')).toHaveLength(2);
    expect(within(region).getByRole('button', { name: '取込を確定' })).toBeEnabled();
  });

  it('競合とerrorがあれば内容と位置を示し確定させない', async () => {
    const commitImport = vi.fn();
    setup({ previewImport: vi.fn().mockResolvedValue(ngPreview), commitImport });
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'previewを作成' }));
    const region = await screen.findByRole('region', { name: '取込preview' });
    expect(within(region).getByText('競合 1件')).toBeInTheDocument();
    expect(within(region).getByText('エラー 1件')).toBeInTheDocument();
    expect(within(region).getByText(/現在の版 2/)).toBeInTheDocument();
    expect(within(region).getByText(/\$\.operations\[1\]\.question\.questionText/)).toBeInTheDocument();
    expect(within(region).getByText(/設問文が空です/)).toBeInTheDocument();
    expect(within(region).getByRole('alert')).toHaveTextContent('競合またはエラーがあるため取り込めません');
    expect(within(region).getByRole('button', { name: '取込を確定' })).toBeDisabled();
  });

  it('commitが注入されcanCommitなら確定でき、二重送信せず件数を表示する', async () => {
    const d = deferred<{ created: number; updated: number; doubtFlagsCleared: number; explanationRequestFlagsCleared: number }>();
    const commitImport = vi.fn().mockReturnValue(d.promise);
    setup({ commitImport });
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'previewを作成' }));
    const button = await screen.findByRole('button', { name: '取込を確定' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(commitImport).toHaveBeenCalledTimes(1);
    expect(commitImport).toHaveBeenCalledWith(okPreview);
    d.resolve({ created: 1, updated: 1, doubtFlagsCleared: 1, explanationRequestFlagsCleared: 0 });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('追加 1件、更新 1件、疑義解除 1件、解説依頼解除 0件'));
    expect(screen.getByRole('status')).toHaveTextContent('最新の状態を再読込');
    expect(screen.queryByRole('region', { name: '取込preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('選択中: return.json')).not.toBeInTheDocument();
  });

  it('commit失敗時はpreviewを保持してalertを示す', async () => {
    const commitImport = vi.fn().mockRejectedValue(new Error('設問交換の取込に失敗しました: stale'));
    setup({ commitImport });
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'previewを作成' }));
    fireEvent.click(await screen.findByRole('button', { name: '取込を確定' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('stale');
    expect(screen.getByRole('region', { name: '取込preview' })).toBeInTheDocument();
    expect(screen.getByText('旧い問い')).toBeInTheDocument();
    expect(screen.getByText('選択中: return.json')).toBeInTheDocument();
  });

  it('取消でpreviewを消し何も書き込まない', async () => {
    const commitImport = vi.fn();
    setup({ commitImport });
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'previewを作成' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(screen.queryByRole('region', { name: '取込preview' })).not.toBeInTheDocument();
    expect(commitImport).not.toHaveBeenCalled();
  });

  it('file未選択ではpreviewを開始できない', () => {
    setup();
    expect(screen.getByRole('button', { name: 'previewを作成' })).toBeDisabled();
  });

  it('preview読込中は二重実行せず、失敗時はfileを保持して再試行できる', async () => {
    const d = deferred<ImportPreview>();
    const previewImport = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(okPreview);
    setup({ previewImport });
    chooseFile();
    const button = screen.getByRole('button', { name: 'previewを作成' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(previewImport).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('previewを作成中…')).toBeInTheDocument();
    d.reject(new Error('設問交換のpreviewを作成できませんでした: network'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('network');
    expect(screen.getByText('選択中: return.json')).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'previewを再試行' }));
    expect(await screen.findByRole('region', { name: '取込preview' })).toBeInTheDocument();
    expect(previewImport).toHaveBeenLastCalledWith(file);
  });
});

describe('QuestionExchangePage レイアウト', () => {
  it('狭い画面でも折返し可能なlayoutで主要操作が並ぶ', () => {
    const { container } = render(<QuestionExchangePage exportEligible={vi.fn()} download={vi.fn()} previewImport={vi.fn()} />);
    const main = container.querySelector('main');
    expect(main).toHaveClass('min-w-0');
    expect(container.innerHTML).not.toMatch(/overflow-x-(auto|scroll)|w-\[\d{3,}px\]/);
    expect(container.querySelectorAll('.flex-wrap').length).toBeGreaterThan(0);
  });
});
