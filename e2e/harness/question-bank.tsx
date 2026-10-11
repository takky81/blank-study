import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import '../../src/index.css';
import { QuestionBankRoute, QUESTION_BANK_ROUTE_DESCRIPTOR } from '../../src/features/questions/QuestionBankRoute';
import type { QuestionBankApi } from '../../src/features/questions/QuestionBankPage';
import type { QuestionContentDraft, QuestionDraft, QuestionFlagPatch, QuestionVersionToken, StructuredQuestion } from '../../src/features/questions/types';

const STORAGE_KEY = 'question-bank-functional-harness';
const materialId = '11111111-1111-4111-8111-111111111111';
const keywordId = '22222222-2222-4222-8222-222222222222';

if (new URLSearchParams(window.location.search).get('reset') === '1') {
  localStorage.removeItem(STORAGE_KEY);
  history.replaceState(null, '', window.location.pathname);
}

type HarnessState = { questions: StructuredQuestion[]; nextId: number };
const readState = (): HarnessState => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{"questions":[],"nextId":1}') as HarnessState;
const writeState = (state: HarnessState) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const now = () => new Date().toISOString();
const ordered = (questions: readonly StructuredQuestion[]) => [...questions].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

function AuthenticatedQuestionBankHarness() {
  const [routeKey, setRouteKey] = useState(0);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const failNextRead = useRef(false);
  const conflictNextSave = useRef(false);

  const api = useMemo<QuestionBankApi>(() => ({
    async listQuestionsByKeyword(requestedKeywordId) {
      if (failNextRead.current) {
        failNextRead.current = false;
        throw new Error('テスト用の読込失敗');
      }
      return ordered(readState().questions.filter((question) => question.keywordId === requestedKeywordId));
    },
    async saveQuestion(draft: QuestionDraft, id?: string, expectedVersion?: number) {
      const state = readState();
      if (id === undefined) {
        const question: StructuredQuestion = {
          id: `question-${state.nextId}`, ownerId: 'authenticated-owner', materialId, keywordId: draft.keywordId,
          questionText: draft.questionText, modelAnswer: draft.modelAnswer, choices: draft.choices,
          explanation: draft.explanation, sortOrder: state.questions.length, isActive: true,
          doubtFlag: true, explanationRequestFlag: true, version: 1, updatedAt: now(),
        };
        writeState({ questions: [...state.questions, question], nextId: state.nextId + 1 });
        return { kind: 'saved' as const, question };
      }
      const current = state.questions.find((question) => question.id === id);
      if (!current) throw new Error('設問が見つかりません。');
      if (conflictNextSave.current) {
        conflictNextSave.current = false;
        const serverCurrent = { ...current, questionText: 'サーバー側で更新された設問', version: current.version + 1, updatedAt: now() };
        writeState({ ...state, questions: state.questions.map((question) => question.id === id ? serverCurrent : question) });
        return { kind: 'version-conflict' as const, current: serverCurrent };
      }
      if (current.version !== expectedVersion) return { kind: 'version-conflict' as const, current };
      const saved = { ...current, ...content(draft), version: current.version + 1, updatedAt: now() };
      writeState({ ...state, questions: state.questions.map((question) => question.id === id ? saved : question) });
      return { kind: 'saved' as const, question: saved };
    },
    async setQuestionFlags(id: string, expectedVersion: number, flags: QuestionFlagPatch) {
      return update(id, expectedVersion, flags);
    },
    async setQuestionActive(id: string, expectedVersion: number, isActive: boolean) {
      return update(id, expectedVersion, { isActive });
    },
    async reorderQuestions(requestedKeywordId: string, tokens: readonly QuestionVersionToken[]) {
      const state = readState();
      const current = ordered(state.questions.filter((question) => question.keywordId === requestedKeywordId));
      for (const token of tokens) {
        const found = current.find((question) => question.id === token.id);
        if (!found || found.version !== token.version) return { kind: 'version-conflict' as const, current: found ?? current[0]! };
      }
      const replacements = tokens.map((token, sortOrder) => {
        const found = current.find((question) => question.id === token.id)!;
        return { ...found, sortOrder, version: found.version + 1, updatedAt: now() };
      });
      writeState({ ...state, questions: state.questions.map((question) => replacements.find((item) => item.id === question.id) ?? question) });
      return replacements;
    },
    async deleteQuestion(id: string, expectedVersion: number) {
      const state = readState();
      const current = state.questions.find((question) => question.id === id);
      if (!current) return 'deleted' as const;
      if (current.version !== expectedVersion) return { kind: 'version-conflict' as const, current };
      writeState({ ...state, questions: state.questions.filter((question) => question.id !== id) });
      return 'deleted' as const;
    },
  }), []);

  return <>
    <aside aria-label="E2E制御" className="flex flex-wrap items-center gap-2 border-b border-line p-2 text-[13px]">
      <strong>{isAuthenticated ? '認証済み' : '未認証'}</strong>
      <span>{QUESTION_BANK_ROUTE_DESCRIPTOR.requiresAuth ? '認証必須route' : '公開route'}</span>
      <button type="button" className="btn-s" onClick={() => setIsAuthenticated((value) => !value)}>
        {isAuthenticated ? '未認証にする' : '認証済みにする'}
      </button>
      <button type="button" className="btn-s" onClick={() => { failNextRead.current = true; }}>次の読込を失敗させる</button>
      <button type="button" className="btn-s" onClick={() => { conflictNextSave.current = true; }}>次の保存を競合させる</button>
      <button type="button" className="btn-s" onClick={() => setRouteKey((value) => value + 1)}>設問バンクを再表示</button>
    </aside>
    {QUESTION_BANK_ROUTE_DESCRIPTOR.requiresAuth && !isAuthenticated
      ? <p role="alert" className="p-4">このrouteの表示には認証が必要です。</p>
      : <MemoryRouter key={routeKey} initialEntries={[`/questions?keywordId=${keywordId}&materialId=${materialId}&returnTo=/questions`]}>
          <QuestionBankRoute
            loader={async () => ({ subjectId: null, materialId, chapterId: null, keyword: { id: keywordId, materialId, label: 'ビット' } })}
            bankApi={api}
          />
        </MemoryRouter>}
  </>;
}

function content(draft: QuestionContentDraft) {
  return { questionText: draft.questionText, modelAnswer: draft.modelAnswer, choices: draft.choices, explanation: draft.explanation };
}

function update(id: string, expectedVersion: number, patch: Partial<StructuredQuestion>) {
  const state = readState();
  const current = state.questions.find((question) => question.id === id);
  if (!current) throw new Error('設問が見つかりません。');
  if (current.version !== expectedVersion) return { kind: 'version-conflict' as const, current };
  const saved = { ...current, ...patch, version: current.version + 1, updatedAt: now() };
  writeState({ ...state, questions: state.questions.map((question) => question.id === id ? saved : question) });
  return { kind: 'saved' as const, question: saved };
}

createRoot(document.getElementById('root')!).render(<AuthenticatedQuestionBankHarness />);
