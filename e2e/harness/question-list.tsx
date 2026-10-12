import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../../src/index.css';
import { QuestionList, type QuestionFlagName } from '../../src/features/questions/QuestionList';
import type { QuestionVersionToken, StructuredQuestion } from '../../src/features/questions/types';

const longText = `狭幅で折り返される設問${'非常に長い語句'.repeat(20)}`;
const initialQuestions: StructuredQuestion[] = [0, 1, 2].map((sortOrder) => ({
  id: `question-${sortOrder}`, ownerId: 'owner', materialId: 'material', keywordId: 'keyword',
  questionText: sortOrder === 1 ? longText : `設問${sortOrder + 1}`, modelAnswer: '答え', choices: [],
  explanation: sortOrder === 1 ? '解説' : null, sortOrder, isActive: true,
  doubtFlag: sortOrder === 1, doubtNote: null, doubtReasons: [], explanationRequestFlag: sortOrder === 1,
  version: 1, updatedAt: '2026-10-11T00:00:00Z',
}));

function Harness() {
  const [questions, setQuestions] = useState(initialQuestions);
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents((current) => [...current, event]);
  return <main className="p-2">
    <QuestionList
      questions={questions}
      onEdit={(question) => record(`edit:${question.id}`)}
      onReorder={async (ordered: readonly QuestionVersionToken[]) => {
        record(`reorder:${ordered.map(({ id }) => id).join(',')}`);
        const next = ordered.flatMap(({ id }, sortOrder) => {
          const found = questions.find((question) => question.id === id);
          return found ? [{ ...found, sortOrder, version: found.version + 1 }] : [];
        });
        setQuestions(next);
        return next;
      }}
      onSetActive={async (question, active) => {
        record(`active:${question.id}:${active}`);
        const saved = { ...question, isActive: active, version: question.version + 1 };
        setQuestions((current) => current.map((item) => item.id === saved.id ? saved : item));
        return { kind: 'saved', question: saved };
      }}
      onClearFlag={async (question, flag: QuestionFlagName) => {
        record(`flag:${question.id}:${flag}`);
        const saved = { ...question, [flag]: false, version: question.version + 1 };
        setQuestions((current) => current.map((item) => item.id === saved.id ? saved : item));
        return { kind: 'saved', question: saved };
      }}
      onDelete={async (question) => {
        record(`delete:${question.id}`);
        setQuestions((current) => current.filter((item) => item.id !== question.id));
        return 'deleted';
      }}
      onVersionConflict={(current) => record(`conflict:${current.id}`)}
    />
    <output aria-label="操作記録">{events.join('|')}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
