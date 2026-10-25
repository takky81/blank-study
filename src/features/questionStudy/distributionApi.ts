import { fetchAll } from '@/lib/paged';
import { supabase } from '@/lib/supabase';
import { ID_CHUNK_SIZE, listQuestionStudyStats } from './api';
import type { DistributionPoint } from './histogram';
import { aggregateKeywordQuestionStudy } from './statsContract';

export type SubjectDistributionSource =
  | Readonly<{
    kind: 'found';
    subjectName: string;
    byQuestion: readonly DistributionPoint[];
    byKeyword: readonly DistributionPoint[];
  }>
  | Readonly<{ kind: 'not-found' }>;

type QuestionRow = { id: string; keyword_id: string };

const CONTEXT = '成績分布を読み込めませんでした';

function readError(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message
    : typeof cause === 'object' && cause !== null && 'message' in cause ? String(cause.message)
      : '原因不明';
  return new Error(`${CONTEXT}: ${message}`, { cause });
}

/**
 * 科目の有効設問と専用statsを全件読み、設問単位とkeyword単位の点列を返す。
 * 科目が読めない（不在・他人の科目）ときは not-found。穴埋め統計は読まない。
 */
export async function loadSubjectDistribution(subjectId: string): Promise<SubjectDistributionSource> {
  try {
    const subject = await supabase.from('subjects').select('id, name').eq('id', subjectId).maybeSingle();
    if (subject.error) throw subject.error;
    if (!subject.data) return { kind: 'not-found' };
    const subjectName = (subject.data as { name: string }).name;

    const materials = await fetchAll<{ id: string }>(async (from, to) => {
      const page = await supabase.from('materials').select('id', { count: 'exact' })
        .eq('subject_id', subjectId).order('id').range(from, to);
      if (page.error) throw page.error;
      return { rows: (page.data ?? []) as { id: string }[], total: page.count };
    });

    const materialIds = materials.map((material) => material.id);
    const questions: QuestionRow[] = [];
    for (let start = 0; start < materialIds.length; start += ID_CHUNK_SIZE) {
      const chunk = materialIds.slice(start, start + ID_CHUNK_SIZE);
      questions.push(...await fetchAll<QuestionRow>(async (from, to) => {
        const page = await supabase.from('structured_questions').select('id, keyword_id', { count: 'exact' })
          .eq('is_active', true).in('material_id', chunk).order('id').range(from, to);
        if (page.error) throw page.error;
        return { rows: (page.data ?? []) as QuestionRow[], total: page.count };
      }));
    }

    const stats = await listQuestionStudyStats(questions.map((question) => question.id));
    const statsById = new Map(stats.map((row) => [row.questionId, row]));
    const byQuestion = questions.map((question) => ({
      askedCount: statsById.get(question.id)?.askedCount ?? 0,
      correctCount: statsById.get(question.id)?.correctCount ?? 0,
    }));
    const byKeyword = aggregateKeywordQuestionStudy(
      questions.map((question) => ({ id: question.id, keywordId: question.keyword_id, isActive: true })),
      stats,
    ).map((aggregate) => ({ askedCount: aggregate.attempts, correctCount: aggregate.correct }));

    return { kind: 'found', subjectName, byQuestion, byKeyword };
  } catch (cause) {
    throw readError(cause);
  }
}
