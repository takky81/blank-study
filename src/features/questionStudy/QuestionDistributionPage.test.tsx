// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import type { SubjectDistributionSource } from './distributionApi';
import { QuestionDistributionPage } from './QuestionDistributionPage';

afterEach(cleanup);

const found: SubjectDistributionSource = {
  kind: 'found',
  subjectName: '情報',
  byQuestion: [
    { askedCount: 0, correctCount: 0 },
    { askedCount: 2, correctCount: 2 },
    { askedCount: 2, correctCount: 1 },
  ],
  byKeyword: [{ askedCount: 4, correctCount: 3 }],
};

function setup(load: (id: string) => Promise<SubjectDistributionSource>) {
  const onExit = vi.fn();
  render(<QuestionDistributionPage subjectId="s1" onExit={onExit} load={load} />);
  return { onExit };
}

describe('QuestionDistributionPage', () => {
  it('読込中は進行状態を表示する', () => {
    setup(() => new Promise(() => {}));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('初期は設問ごとで、両ヒストグラムの階級名と件数を文字で示す', async () => {
    setup(vi.fn().mockResolvedValue(found));
    expect(await screen.findByRole('radio', { name: '設問ごと' })).toBeChecked();
    expect(screen.getByText('情報')).toBeInTheDocument();
    expect(screen.getByLabelText('未出題 1件')).toBeInTheDocument();
    expect(screen.getByLabelText('100% 1件')).toBeInTheDocument();
    expect(screen.getByLabelText('50%以上60%未満 1件')).toBeInTheDocument();
    expect(screen.getByLabelText('2回 2件')).toBeInTheDocument();
    expect(screen.getAllByText('全3件')).toHaveLength(2);
  });

  it('キーワードごとへ切り替えても再読込せず同じ科目の分布を描き直す', async () => {
    const load = vi.fn().mockResolvedValue(found);
    setup(load);
    fireEvent.click(await screen.findByRole('radio', { name: 'キーワードごと' }));
    expect(screen.getByLabelText('70%以上80%未満 1件')).toBeInTheDocument();
    expect(screen.getByLabelText('4回 1件')).toBeInTheDocument();
    expect(screen.getAllByText('全1件')).toHaveLength(2);
    expect(screen.getByText('情報')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('有効設問がない科目は空状態を表示する', async () => {
    setup(vi.fn().mockResolvedValue({ kind: 'found', subjectName: '情報', byQuestion: [], byKeyword: [] }));
    expect(await screen.findByText('この科目に有効な設問はありません')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('読取失敗はエラーと再試行を表示し、再試行で読み直す', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(found);
    setup(load);
    expect(await screen.findByRole('alert')).toHaveTextContent('成績分布を読み込めませんでした');
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('radio', { name: '設問ごと' })).toBeInTheDocument();
  });

  it('参照できない科目は集計を出さず範囲選択へ戻る導線を出す', async () => {
    const { onExit } = setup(vi.fn().mockResolvedValue({ kind: 'not-found' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('指定された科目を表示できません');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '範囲選択へ戻る' }));
    expect(onExit).toHaveBeenCalled();
  });
});
