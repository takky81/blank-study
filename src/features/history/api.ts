import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/paged';
import type { StatRow } from './aggregate';

function fail(message: string, error: { message: string } | null): never {
  throw new Error(`${message}: ${error?.message ?? '原因不明'}`);
}

export type HistoryNode = {
  kind: 'subject' | 'material' | 'chapter';
  id: string;
  title: string;
  parentId: string | null;
  keywordIds: string[];
  children: HistoryNode[];
};

export type HistoryData = {
  tree: HistoryNode[];
  rows: Map<string, StatRow>;
  logs: { answeredAt: Date; correct: boolean }[];
};

/** 学習履歴の階層と集計のもとになるデータを一度に読む。 */
export async function loadHistory(): Promise<HistoryData> {
  const [subjects, materials, chapters, keywords, logs] = await Promise.all([
    supabase.from('subjects').select('id, name, sort_order').order('sort_order'),
    supabase.from('materials').select('id, name, subject_id, sort_order').order('sort_order'),
    supabase
      .from('chapters')
      .select('id, title, material_id, parent_id, sort_order')
      .order('sort_order'),
    // 行数上限で切られると、集計から漏れる（決定表「学習履歴の集計」列20）
    fetchAll(async (from, to) => {
      const page = await supabase
        .from('keywords')
        .select(
          'id, answers, chapter_id, material_id, is_active, keyword_stats(total_count, correct_count, due_at)',
          { count: 'exact' },
        )
        .order('id')
        .range(from, to);
      if (page.error) fail('キーワードの取得に失敗しました', page.error);
      return { rows: page.data ?? [], total: page.count };
    }),
    fetchAll(async (from, to) => {
      const page = await supabase
        .from('answer_logs')
        .select('answered_at, is_correct', { count: 'exact' })
        // 分割して取るので、並びは一意に決まるものにする
        .order('id')
        .range(from, to);
      if (page.error) fail('解答履歴の取得に失敗しました', page.error);
      return { rows: page.data ?? [], total: page.count };
    }),
  ]);
  for (const [message, result] of [
    ['科目の取得に失敗しました', subjects],
    ['教材の取得に失敗しました', materials],
    ['章の取得に失敗しました', chapters],
  ] as const) {
    if (result.error) fail(message, result.error);
  }

  const rows = new Map<string, StatRow>();
  for (const k of keywords) {
    const stats = Array.isArray(k.keyword_stats) ? k.keyword_stats[0] : k.keyword_stats;
    rows.set(k.id, {
      keywordId: k.id,
      answers: k.answers ?? [],
      chapterId: k.chapter_id,
      isActive: k.is_active,
      totalCount: stats?.total_count ?? 0,
      correctCount: stats?.correct_count ?? 0,
      dueAt: stats?.due_at ? new Date(stats.due_at) : null,
    });
  }

  const keywordsOfChapter = (chapterId: string): string[] =>
    keywords.filter((k) => k.chapter_id === chapterId).map((k) => k.id as string);

  const chapterNodes = (materialId: string, parentId: string | null): HistoryNode[] =>
    (chapters.data ?? [])
      .filter((c) => c.material_id === materialId && c.parent_id === parentId)
      .map((c) => {
        const children = chapterNodes(materialId, c.id);
        return {
          kind: 'chapter' as const,
          id: c.id,
          title: c.title,
          parentId,
          keywordIds: [...keywordsOfChapter(c.id), ...children.flatMap((n) => n.keywordIds)],
          children,
        };
      });

  const tree: HistoryNode[] = (subjects.data ?? []).map((subject) => {
    const children = (materials.data ?? [])
      .filter((m) => m.subject_id === subject.id)
      .map((m) => {
        const chapterChildren = chapterNodes(m.id, null);
        // 章から外れたキーワードも教材の集計には含める
        const loose = keywords
          .filter((k) => k.material_id === m.id && k.chapter_id === null)
          .map((k) => k.id as string);
        return {
          kind: 'material' as const,
          id: m.id as string,
          title: m.name as string,
          parentId: subject.id as string,
          keywordIds: [...chapterChildren.flatMap((n) => n.keywordIds), ...loose],
          children: chapterChildren,
        };
      });
    return {
      kind: 'subject' as const,
      id: subject.id,
      title: subject.name,
      parentId: null,
      keywordIds: children.flatMap((n) => n.keywordIds),
      children,
    };
  });

  return {
    tree,
    rows,
    logs: logs.map((l) => ({
      answeredAt: new Date(l.answered_at),
      correct: l.is_correct,
    })),
  };
}
