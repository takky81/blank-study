import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { fetchAll } from '@/lib/paged';
import { supabase } from '@/lib/supabase';
import { QuestionBankPage, type QuestionBankApi, type QuestionBankKeywordContext } from './QuestionBankPage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HierarchyParameters = {
  subjectId: string | null;
  materialId: string | null;
  chapterId: string | null;
  keywordId: string | null;
};

export type QuestionBankRouteContext = {
  subjectId: string | null;
  materialId: string | null;
  chapterId: string | null;
  keyword: QuestionBankKeywordContext | null;
  keywords?: readonly QuestionBankKeywordContext[];
};

export type QuestionBankRouteLoader = (
  parameters: HierarchyParameters,
) => Promise<QuestionBankRouteContext | null>;

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

type QuestionBankRouteProps = {
  loader?: QuestionBankRouteLoader;
  bankApi?: QuestionBankApi;
};

type RouteState =
  | { kind: 'loading' }
  | { kind: 'ready'; context: QuestionBankRouteContext }
  | { kind: 'error' };

export const QUESTION_BANK_ROUTE_DESCRIPTOR = {
  id: 'questions.bank',
  path: '/questions',
  element: <QuestionBankRoute />,
  requiresAuth: true,
  navigation: {
    id: 'nav.questions.bank',
    label: '設問',
    to: '/questions',
    placements: ['wide', 'narrow'],
  },
} satisfies LocalFeatureRouteDescriptor;

export function QuestionBankRoute({ loader = loadQuestionBankRouteContext, bankApi }: QuestionBankRouteProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseRouteSearch(location.search), [location.search]);
  const [state, setState] = useState<RouteState>({ kind: 'loading' });
  const [selectedKeyword, setSelectedKeyword] = useState<QuestionBankKeywordContext | null>(null);

  useEffect(() => {
    let active = true;
    if (parsed === null) {
      setState({ kind: 'error' });
      return () => { active = false; };
    }

    setState({ kind: 'loading' });
    setSelectedKeyword(null);
    void loader(parsed.parameters)
      .then((context) => {
        if (active) setState(context === null ? { kind: 'error' } : { kind: 'ready', context });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => { active = false; };
  }, [loader, parsed]);

  if (state.kind === 'loading') {
    return <main className="mx-auto max-w-4xl p-6"><p role="status">設問バンクを読み込み中…</p></main>;
  }

  if (state.kind === 'error' || parsed === null) {
    return <main className="mx-auto flex max-w-4xl flex-col items-start gap-4 p-6">
      <h1 className="text-[22px]">設問バンク</h1>
      <p role="alert">設問バンクを開けません。指定内容を確認してください。</p>
      <button type="button" className="btn" onClick={() => navigate('/', { replace: true })}>ホームへ戻る</button>
    </main>;
  }

  const { context } = state;
  const keyword = selectedKeyword ?? context.keyword;
  const goBack = () => navigate(parsed.returnTo);
  if (keyword === null) {
    const keywords = context.keywords ?? [];
    return <main className="mx-auto flex max-w-4xl flex-col items-start gap-4 p-6">
      <h1 className="text-[22px]">設問バンク</h1>
      <p role="status">{keywords.length === 0 ? '選択できるキーワードがありません。' : '対象のキーワードを選択してください。'}</p>
      {keywords.length > 0 && <ul className="grid w-full gap-2">
        {keywords.map((item) => <li key={item.id}>
          <button type="button" className="btn min-h-11 w-full justify-start" onClick={() => setSelectedKeyword(item)}>{item.label}</button>
        </li>)}
      </ul>}
      <button type="button" className="btn" onClick={goBack}>取消</button>
    </main>;
  }

  return <>
    <div className="mx-auto flex max-w-4xl justify-end gap-2 px-4 pt-4 sm:px-10">
      <button type="button" className="btn" onClick={goBack}>取消</button>
      <button type="button" className="btn-p" onClick={goBack}>完了</button>
    </div>
    <QuestionBankPage
      materialId={keyword.materialId}
      keyword={keyword}
      onBack={goBack}
      api={bankApi}
    />
  </>;
}

function parseRouteSearch(search: string): { parameters: HierarchyParameters; returnTo: string } | null {
  const query = new URLSearchParams(search);
  const parameterNames = ['subjectId', 'materialId', 'chapterId', 'keywordId'] as const;
  const parameters = {} as HierarchyParameters;
  for (const name of parameterNames) {
    const values = query.getAll(name);
    if (values.length > 1) return null;
    const value = values[0];
    if (value === undefined || value === '') parameters[name] = null;
    else if (!UUID_PATTERN.test(value)) return null;
    else parameters[name] = value.toLowerCase();
  }

  const returnValues = query.getAll('returnTo');
  if (returnValues.length > 1) return null;
  const returnTo = resolveReturnTo(returnValues[0]);
  if (returnValues[0] !== undefined && returnTo === null) return null;
  return { parameters, returnTo: returnTo ?? '/' };
}

function resolveReturnTo(value: string | undefined): string | null {
  if (value === undefined || value === '') return '/';
  if (value === '/' || value === '/questions') return value;
  if (value.includes('?') || value.includes('#') || value.includes('\\') || value.startsWith('//')) return null;
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  const subject = value.match(/^\/subjects\/([^/]+)$/)?.[1];
  if (subject && UUID_PATTERN.test(subject)) return `/subjects/${subject.toLowerCase()}`;
  const material = value.match(/^\/materials\/([^/]+)\/edit$/)?.[1];
  if (material && UUID_PATTERN.test(material)) return `/materials/${material.toLowerCase()}/edit`;
  return null;
}

export async function loadQuestionBankRouteContext(
  parameters: HierarchyParameters,
): Promise<QuestionBankRouteContext | null> {
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) return null;

  let subjectId = parameters.subjectId;
  let materialId = parameters.materialId;
  let chapterId = parameters.chapterId;
  let keyword: QuestionBankKeywordContext | null = null;

  if (parameters.keywordId) {
    const result = await supabase
      .from('keywords')
      .select('id, material_id, chapter_id, answers')
      .eq('id', parameters.keywordId)
      .maybeSingle();
    if (result.error || !result.data) return null;
    if (materialId && materialId !== result.data.material_id) return null;
    if (chapterId && chapterId !== result.data.chapter_id) return null;
    materialId = result.data.material_id;
    chapterId = chapterId ?? result.data.chapter_id;
    keyword = {
      id: result.data.id,
      materialId: result.data.material_id,
      label: result.data.answers[0] ?? 'キーワード',
    };
  }

  if (chapterId) {
    const result = await supabase
      .from('chapters')
      .select('id, material_id')
      .eq('id', chapterId)
      .maybeSingle();
    if (result.error || !result.data) return null;
    if (materialId && materialId !== result.data.material_id) return null;
    materialId = result.data.material_id;
  }

  if (materialId) {
    const result = await supabase
      .from('materials')
      .select('id, subject_id')
      .eq('id', materialId)
      .maybeSingle();
    if (result.error || !result.data) return null;
    if (subjectId && subjectId !== result.data.subject_id) return null;
    subjectId = result.data.subject_id;
  }

  if (subjectId) {
    const result = await supabase.from('subjects').select('id').eq('id', subjectId).maybeSingle();
    if (result.error || !result.data) return null;
  }

  const keywords = keyword === null
    ? await listSelectableKeywords({ subjectId, materialId, chapterId })
    : [];
  return { subjectId, materialId, chapterId, keyword, keywords };
}

type KeywordSelectionRow = {
  id: string;
  material_id: string;
  answers: string[];
};

async function listSelectableKeywords(scope: {
  subjectId: string | null;
  materialId: string | null;
  chapterId: string | null;
}): Promise<QuestionBankKeywordContext[]> {
  let materialIds: string[] | null = scope.materialId ? [scope.materialId] : null;
  if (materialIds === null && scope.subjectId) {
    const rows = await fetchAll<{ id: string }>(async (from, to) => {
      const result = await supabase
        .from('materials')
        .select('id', { count: 'exact' })
        .eq('subject_id', scope.subjectId as string)
        .order('id')
        .range(from, to);
      if (result.error) throw new Error(`教材の取得に失敗しました: ${result.error.message}`);
      return { rows: result.data ?? [], total: result.count };
    });
    materialIds = rows.map(({ id }) => id);
    if (materialIds.length === 0) return [];
  }

  const rows = await fetchAll<KeywordSelectionRow>(async (from, to) => {
    let query = supabase
      .from('keywords')
      .select('id, material_id, answers', { count: 'exact' })
      .order('id');
    if (scope.chapterId) query = query.eq('chapter_id', scope.chapterId);
    else if (materialIds) query = query.in('material_id', materialIds);
    const result = await query.range(from, to);
    if (result.error) throw new Error(`キーワードの取得に失敗しました: ${result.error.message}`);
    return { rows: result.data ?? [], total: result.count };
  });
  return rows.map((row) => ({
    id: row.id,
    materialId: row.material_id,
    label: row.answers[0] ?? 'キーワード',
  }));
}
