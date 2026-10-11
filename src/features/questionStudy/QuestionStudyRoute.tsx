import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { QuestionStudyScope } from './candidates';
import { StructuredQuestionStudyPage } from './StructuredQuestionStudyPage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_KINDS = ['subject', 'material', 'chapter', 'keyword'] as const;
const DEFAULT_RETURN_TO = '/questions';

type LocalFeatureRouteDescriptor = {
  id: string;
  path: string;
  element: React.ReactElement;
  requiresAuth: true;
  navigation: {
    id: string;
    label: string;
    to: string;
    placements: readonly ('wide' | 'narrow')[];
  };
};

export const QUESTION_STUDY_ROUTE_DESCRIPTOR = {
  id: 'questions.study',
  path: '/question-study',
  element: <QuestionStudyRoute />,
  requiresAuth: true,
  navigation: {
    id: 'nav.questions.study',
    label: '設問学習',
    to: '/question-study',
    placements: ['wide', 'narrow'],
  },
} satisfies LocalFeatureRouteDescriptor;

/**
 * 構造化設問学習pageのroute adapter。
 * 所有者確認は認証必須routeとpage内のowner-scoped読込（RLS）が担う。
 * parameter不正時はpageを描画しないため、読込・記録は一切始まらない。
 */
export function QuestionStudyRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseRouteSearch(location.search), [location.search]);

  if (parsed === null) {
    return <main className="mx-auto flex max-w-4xl flex-col items-start gap-4 p-6">
      <h1 className="text-[22px]">設問学習</h1>
      <p role="alert">設問学習を開けません。指定内容を確認してください。</p>
      <button type="button" className="btn" onClick={() => navigate(DEFAULT_RETURN_TO, { replace: true })}>設問へ戻る</button>
    </main>;
  }

  return <StructuredQuestionStudyPage
    key={location.search}
    initialScope={parsed.scope}
    onExit={() => navigate(parsed.returnTo)}
  />;
}

function single(query: URLSearchParams, name: string): string | undefined | null {
  const values = query.getAll(name);
  if (values.length > 1) return null;
  return values[0];
}

function parseRouteSearch(search: string): { scope: QuestionStudyScope | null; returnTo: string } | null {
  const query = new URLSearchParams(search);
  const kind = single(query, 'scope');
  const id = single(query, 'scopeId');
  const rawReturnTo = single(query, 'returnTo');
  if (kind === null || id === null || rawReturnTo === null) return null;

  let scope: QuestionStudyScope | null = null;
  const hasKind = kind !== undefined && kind !== '';
  const hasId = id !== undefined && id !== '';
  if (hasKind !== hasId) return null;
  if (hasKind && hasId) {
    if (!(SCOPE_KINDS as readonly string[]).includes(kind)) return null;
    if (!UUID_PATTERN.test(id)) return null;
    scope = { kind: kind as QuestionStudyScope['kind'], id: id.toLowerCase() };
  }

  const returnTo = resolveReturnTo(rawReturnTo);
  if (returnTo === null) return null;
  return { scope, returnTo };
}

function resolveReturnTo(value: string | undefined): string | null {
  if (value === undefined || value === '') return DEFAULT_RETURN_TO;
  if (value === '/' || value === '/questions') return value;
  if (value.includes('?') || value.includes('#') || value.includes('\\') || value.startsWith('//')) return null;
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  const subject = value.match(/^\/subjects\/([^/]+)$/)?.[1];
  if (subject && UUID_PATTERN.test(subject)) return `/subjects/${subject.toLowerCase()}`;
  const material = value.match(/^\/materials\/([^/]+)\/edit$/)?.[1];
  if (material && UUID_PATTERN.test(material)) return `/materials/${material.toLowerCase()}/edit`;
  return null;
}
