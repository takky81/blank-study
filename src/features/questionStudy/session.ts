import { pickNext, type Candidate } from '@/features/study/order';
import type { QuestionStudyCandidate, QuestionStudyStats } from './candidates';

export type QuestionStudyOrder = 'auto' | 'sequential';

export type QuestionSessionResult = Readonly<{
  answered: number;
  correct: number;
  total: number;
  /** 全候補への解答が完了した。 */
  completed: boolean;
  /** 完了または途中終了で、以降は出題しない。 */
  ended: boolean;
}>;

export type QuestionSession = Readonly<{
  order: QuestionStudyOrder;
  /** 候補射影の安定順のまま保持する。 */
  candidates: readonly QuestionStudyCandidate[];
  answeredIds: readonly string[];
  result: QuestionSessionResult;
}>;

export function startQuestionSession(
  candidates: readonly QuestionStudyCandidate[],
  order: QuestionStudyOrder,
): QuestionSession {
  const total = candidates.length;
  return {
    order,
    candidates,
    answeredIds: [],
    result: { answered: 0, correct: 0, total, completed: total === 0, ended: total === 0 },
  };
}

/**
 * 次の1問を選ぶ。未回答候補が無い、または終了済みなら null。
 * 順序規則は既存の `pickNext` に委ね、同着は乱数ではなく
 * 専用習熟状態（連続正解の少ない順）→ 候補の安定順で決めて再現可能にする。
 */
export function pickNextQuestion(session: QuestionSession, now: Date): QuestionStudyCandidate | null {
  if (session.result.ended) return null;
  const answered = new Set(session.answeredIds);
  const remaining = session.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => !answered.has(candidate.question.id));
  if (remaining.length === 0) return null;

  const ordered = session.order === 'auto'
    ? [...remaining].sort((a, b) => mastery(a.candidate) - mastery(b.candidate) || a.index - b.index)
    : remaining;
  const byId = new Map(ordered.map(({ candidate }) => [candidate.question.id, candidate]));
  const adapted: Candidate[] = ordered.map(({ candidate, index }) => ({
    keywordId: candidate.question.id,
    position: index,
    dueAt: candidate.stats?.dueAt ? new Date(candidate.stats.dueAt) : null,
  }));

  const picked = pickNext(adapted, {
    order: session.order,
    recent: session.answeredIds,
    now,
    // 同着は入力順（習熟→安定順）を保つ。Array.prototype.sort は安定。
    random: () => 0,
  });
  return picked ? byId.get(picked.keywordId) ?? null : null;
}

/**
 * 解答確定を反映する。確定statsがあれば候補の成績を置き換え、次の選定に使う。
 * 同じ設問の二重確定や終了後の確定は件数を変えない（statsのみ更新）。
 */
export function recordQuestionSessionAnswer(
  session: QuestionSession,
  questionId: string,
  isCorrect: boolean,
  confirmedStats?: QuestionStudyStats,
): QuestionSession {
  const candidates = confirmedStats
    ? session.candidates.map((c) => (c.question.id === questionId ? { ...c, stats: confirmedStats } : c))
    : session.candidates;
  const known = session.candidates.some((c) => c.question.id === questionId);
  if (!known || session.result.ended || session.answeredIds.includes(questionId)) {
    return { ...session, candidates };
  }
  const answered = session.result.answered + 1;
  const completed = answered >= session.result.total;
  return {
    ...session,
    candidates,
    answeredIds: [...session.answeredIds, questionId],
    result: {
      ...session.result,
      answered,
      correct: session.result.correct + (isCorrect ? 1 : 0),
      completed,
      ended: completed,
    },
  };
}

/** 途中終了。記録済みの件数を保持したまま出題を止める。 */
export function finishQuestionSession(session: QuestionSession): QuestionSession {
  return { ...session, result: { ...session.result, ended: true } };
}

function mastery(candidate: QuestionStudyCandidate): number {
  return candidate.stats?.consecutiveCorrect ?? 0;
}
