import {
  listKeywordQuestionStudyAggregates,
  loadQuestionStudyCandidates,
} from '../../src/features/questionStudy/api';
import type { QuestionStudyScope } from '../../src/features/questionStudy/candidates';
import type { KeywordQuestionStudyAggregate } from '../../src/features/questionStudy/statsContract';

export type VolumeCandidate = {
  id: string;
  keywordId: string;
  chapterOrder: number | null;
  bodyOccurrenceIndex: number | null;
  questionOrder: number;
  hasStats: boolean;
  dueAt: string | null;
};

/**
 * 本番の設問学習read path（候補・keyword集計）を、ブラウザの認証sessionで実行する。
 */
export async function readQuestionStudyVolume(
  scopes: readonly QuestionStudyScope[],
  materialId: string,
): Promise<{ candidates: VolumeCandidate[][]; aggregates: KeywordQuestionStudyAggregate[] }> {
  const candidates: VolumeCandidate[][] = [];
  for (const scope of scopes) {
    const loaded = await loadQuestionStudyCandidates(scope);
    candidates.push(loaded.map((candidate) => ({
      id: candidate.question.id,
      keywordId: candidate.question.keywordId,
      chapterOrder: candidate.chapterOrder,
      bodyOccurrenceIndex: candidate.bodyOccurrenceIndex,
      questionOrder: candidate.questionOrder,
      hasStats: candidate.stats !== null,
      dueAt: candidate.stats?.dueAt ?? null,
    })));
  }
  const aggregates = await listKeywordQuestionStudyAggregates({ materialId });
  return { candidates, aggregates };
}
