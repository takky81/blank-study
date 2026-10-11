import { describe, expect, it } from 'vitest';

import type { StructuredQuestion } from '@/features/questions/types';
import type { QuestionStudyCandidate, QuestionStudyStats } from './candidates';
import {
  finishQuestionSession,
  pickNextQuestion,
  recordQuestionSessionAnswer,
  startQuestionSession,
} from './session';

const now = new Date('2026-10-11T00:00:00.000Z');

function candidate(id: string, index: number, stats: Partial<QuestionStudyStats> | null = null): QuestionStudyCandidate {
  const question = { id, keywordId: `k-${id}`, sortOrder: index } as StructuredQuestion;
  return {
    question,
    stats: stats === null ? null : {
      questionId: id, askedCount: 1, correctCount: 1, consecutiveCorrect: 1,
      intervalDays: 1, easeFactor: 2.5, dueAt: null, updatedAt: now.toISOString(), ...stats,
    },
    subjectOrder: 0, materialOrder: 0, chapterOrder: 0, bodyOccurrenceIndex: index,
    keywordOrder: index, questionOrder: index,
  };
}

const statsOf = (id: string, s: Partial<QuestionStudyStats>): QuestionStudyStats => ({
  questionId: id, askedCount: 1, correctCount: 1, consecutiveCorrect: 1,
  intervalDays: 1, easeFactor: 2.5, dueAt: null, updatedAt: now.toISOString(), ...s,
});

describe('QuestionSessionPolicy', () => {
  it('自動順は未出題を優先し、次に期限が近い順、同着は習熟の低い順で選ぶ', () => {
    const candidates = [
      candidate('late', 0, { dueAt: '2026-10-20T00:00:00.000Z' }),
      candidate('soon-high', 1, { dueAt: '2026-10-12T00:00:00.000Z', consecutiveCorrect: 5 }),
      candidate('soon-low', 2, { dueAt: '2026-10-12T00:00:00.000Z', consecutiveCorrect: 0 }),
      candidate('new', 3),
    ];
    let session = startQuestionSession(candidates, 'auto');
    const order: string[] = [];
    for (let q = pickNextQuestion(session, now); q; q = pickNextQuestion(session, now)) {
      order.push(q.question.id);
      session = recordQuestionSessionAnswer(session, q.question.id, true);
    }
    expect(order).toEqual(['new', 'soon-low', 'soon-high', 'late']);
  });

  it('出現順は候補の安定順に従う', () => {
    const candidates = [candidate('a', 0, { dueAt: '2027-01-01T00:00:00.000Z' }), candidate('b', 1), candidate('c', 2)];
    let session = startQuestionSession(candidates, 'sequential');
    const order: string[] = [];
    for (let q = pickNextQuestion(session, now); q; q = pickNextQuestion(session, now)) {
      order.push(q.question.id);
      session = recordQuestionSessionAnswer(session, q.question.id, false);
    }
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('未回答の候補が残る間は直前の設問を連続出題しない', () => {
    let session = startQuestionSession([candidate('a', 0), candidate('b', 1)], 'sequential');
    const first = pickNextQuestion(session, now);
    session = recordQuestionSessionAnswer(session, first!.question.id, false);
    expect(pickNextQuestion(session, now)?.question.id).not.toBe(first!.question.id);
  });

  it('確定ごとに回答済み・正解件数を更新し、全候補完了で終了する', () => {
    let session = startQuestionSession([candidate('a', 0), candidate('b', 1)], 'sequential');
    session = recordQuestionSessionAnswer(session, 'a', true);
    expect(session.result).toEqual({ answered: 1, correct: 1, total: 2, completed: false, ended: false });
    session = recordQuestionSessionAnswer(session, 'b', false);
    expect(session.result).toEqual({ answered: 2, correct: 1, total: 2, completed: true, ended: true });
    expect(pickNextQuestion(session, now)).toBeNull();
  });

  it('同じ設問の二重確定は件数を増やさない', () => {
    let session = startQuestionSession([candidate('a', 0), candidate('b', 1)], 'sequential');
    session = recordQuestionSessionAnswer(session, 'a', true);
    session = recordQuestionSessionAnswer(session, 'a', true);
    expect(session.result.answered).toBe(1);
  });

  it('途中終了は記録済み結果を保持して以降の出題を止める', () => {
    let session = startQuestionSession([candidate('a', 0), candidate('b', 1)], 'sequential');
    session = recordQuestionSessionAnswer(session, 'a', true);
    session = finishQuestionSession(session);
    expect(session.result).toEqual({ answered: 1, correct: 1, total: 2, completed: false, ended: true });
    expect(pickNextQuestion(session, now)).toBeNull();
  });

  it('確定statsで候補の成績を更新し、次の選定に使う', () => {
    const candidates = [
      candidate('a', 0, { dueAt: '2026-10-12T00:00:00.000Z' }),
      candidate('b', 1, { dueAt: '2026-10-13T00:00:00.000Z' }),
      candidate('c', 2),
    ];
    let session = startQuestionSession(candidates, 'auto');
    session = recordQuestionSessionAnswer(session, 'c', true, statsOf('c', { dueAt: '2026-10-30T00:00:00.000Z' }));
    expect(session.candidates.find((x) => x.question.id === 'c')?.stats?.dueAt).toBe('2026-10-30T00:00:00.000Z');
    expect(pickNextQuestion(session, now)?.question.id).toBe('a');
  });

  it('同じ入力と確定statsから同じ次問と結果を再現する', () => {
    const make = () => startQuestionSession(
      [candidate('a', 0), candidate('b', 1), candidate('c', 2)], 'auto');
    const run = () => {
      let s = make();
      const ids: string[] = [];
      for (let q = pickNextQuestion(s, now); q; q = pickNextQuestion(s, now)) {
        ids.push(q.question.id);
        s = recordQuestionSessionAnswer(s, q.question.id, ids.length % 2 === 0);
      }
      return { ids, result: s.result };
    };
    expect(run()).toEqual(run());
  });

  it('候補0件は開始時点で完了・終了し出題しない', () => {
    const session = startQuestionSession([], 'auto');
    expect(session.result).toEqual({ answered: 0, correct: 0, total: 0, completed: true, ended: true });
    expect(pickNextQuestion(session, now)).toBeNull();
  });

  it('候補1件は直近回避で詰まらず出題し、確定で完了する', () => {
    let session = startQuestionSession([candidate('only', 0, { dueAt: '2026-10-12T00:00:00.000Z' })], 'auto');
    expect(pickNextQuestion(session, now)?.question.id).toBe('only');
    session = recordQuestionSessionAnswer(session, 'only', false);
    expect(session.result).toMatchObject({ answered: 1, correct: 0, completed: true, ended: true });
    expect(pickNextQuestion(session, now)).toBeNull();
  });

  it('自動順で期限と習熟が同着なら候補の安定順で選ぶ', () => {
    const due = { dueAt: '2026-10-12T00:00:00.000Z', consecutiveCorrect: 2 };
    const session = startQuestionSession([candidate('x', 0, due), candidate('y', 1, due)], 'auto');
    expect(pickNextQuestion(session, now)?.question.id).toBe('x');
  });

  it('出現順は確定statsで成績が変わっても安定順のまま', () => {
    let session = startQuestionSession([candidate('a', 0), candidate('b', 1), candidate('c', 2)], 'sequential');
    session = recordQuestionSessionAnswer(session, 'a', true, statsOf('a', { dueAt: '2026-10-30T00:00:00.000Z' }));
    expect(pickNextQuestion(session, now)?.question.id).toBe('b');
  });

  it('終了後と未知の設問の確定は件数を変えない', () => {
    let session = startQuestionSession([candidate('a', 0), candidate('b', 1)], 'sequential');
    session = recordQuestionSessionAnswer(session, 'unknown', true);
    expect(session.result.answered).toBe(0);
    session = recordQuestionSessionAnswer(finishQuestionSession(session), 'a', true);
    expect(session.result).toMatchObject({ answered: 0, ended: true });
  });
});
