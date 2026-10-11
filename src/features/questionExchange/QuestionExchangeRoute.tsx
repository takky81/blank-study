import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { resolveFeatureReturnTo } from '@/app/featureRoutes';
import { supabase } from '@/lib/supabase';
import { QuestionExchangePage } from './QuestionExchangePage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_RETURN_TO = '/questions';
const PARAMETER_NAMES = ['subjectId', 'materialId', 'chapterId', 'keywordId'] as const;

export type QuestionExchangeHierarchy = Record<(typeof PARAMETER_NAMES)[number], string | null>;

/** 階層parameterがowner範囲内で整合するときだけtrueを返す読取専用の照会。 */
export type QuestionExchangeHierarchyLoader = (hierarchy: QuestionExchangeHierarchy) => Promise<boolean>;

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

export const QUESTION_EXCHANGE_ROUTE_DESCRIPTOR = {
  id: 'questions.exchange',
  path: '/question-exchange',
  element: <QuestionExchangeRoute />,
  requiresAuth: true,
  navigation: {
    id: 'nav.questions.exchange',
    label: '設問交換',
    to: '/question-exchange',
    placements: ['wide'],
  },
} satisfies LocalFeatureRouteDescriptor;

type RouteState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error' };

/**
 * 設問交換pageのroute adapter。未認証時の扱いはapp-shellの認証必須routeが担う。
 * parameter不正・階層不一致・許可外returnToではpageを描画しないため、抽出や書込みは始まらない。
 */
export function QuestionExchangeRoute({ loader = loadQuestionExchangeHierarchy }: { loader?: QuestionExchangeHierarchyLoader }) {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseRouteSearch(location.search), [location.search]);
  const [state, setState] = useState<RouteState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    if (parsed === null) {
      setState({ kind: 'error' });
      return () => { active = false; };
    }
    if (PARAMETER_NAMES.every((name) => parsed.hierarchy[name] === null)) {
      setState({ kind: 'ready' });
      return () => { active = false; };
    }
    setState({ kind: 'loading' });
    void loader(parsed.hierarchy)
      .then((valid) => { if (active) setState({ kind: valid ? 'ready' : 'error' }); })
      .catch(() => { if (active) setState({ kind: 'error' }); });
    return () => { active = false; };
  }, [loader, parsed]);

  if (state.kind === 'error' || parsed === null) {
    return <main className="mx-auto flex max-w-4xl flex-col items-start gap-4 p-6">
      <h1 className="text-[22px]">設問交換</h1>
      <p role="alert">設問交換を開けません。指定内容を確認してください。</p>
      <button type="button" className="btn" onClick={() => navigate(DEFAULT_RETURN_TO, { replace: true })}>設問へ戻る</button>
    </main>;
  }

  if (state.kind === 'loading') {
    return <main className="mx-auto max-w-4xl p-6"><p role="status">設問交換を読み込み中…</p></main>;
  }

  const goBack = () => navigate(parsed.returnTo);
  return <>
    <div className="mx-auto flex max-w-4xl justify-end gap-2 px-4 pt-4 sm:px-10">
      <button type="button" className="btn" onClick={goBack}>取消</button>
      <button type="button" className="btn-p" onClick={goBack}>完了</button>
    </div>
    <QuestionExchangePage key={location.search} />
  </>;
}

function parseRouteSearch(search: string): { hierarchy: QuestionExchangeHierarchy; returnTo: string } | null {
  const query = new URLSearchParams(search);
  const hierarchy = {} as QuestionExchangeHierarchy;
  for (const name of PARAMETER_NAMES) {
    const values = query.getAll(name);
    if (values.length > 1) return null;
    const value = values[0];
    if (value === undefined || value === '') hierarchy[name] = null;
    else if (!UUID_PATTERN.test(value)) return null;
    else hierarchy[name] = value.toLowerCase();
  }

  const returnValues = query.getAll('returnTo');
  if (returnValues.length > 1) return null;
  const raw = returnValues[0];
  if (raw === undefined || raw === '') return { hierarchy, returnTo: DEFAULT_RETURN_TO };
  // 共有allowlistで許可外は空文字fallbackとなり、error扱いにする。
  const returnTo = resolveFeatureReturnTo(raw, '');
  if (returnTo === '') return null;
  return { hierarchy, returnTo };
}

/** owner-scoped（RLS）読取で上位から下位までの親子関係を照合する。 */
export async function loadQuestionExchangeHierarchy(hierarchy: QuestionExchangeHierarchy): Promise<boolean> {
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) return false;

  let { materialId } = hierarchy;
  const { subjectId, chapterId, keywordId } = hierarchy;

  if (keywordId) {
    const result = await supabase.from('keywords').select('id, material_id, chapter_id').eq('id', keywordId).maybeSingle();
    if (result.error || !result.data) return false;
    if (materialId && materialId !== result.data.material_id) return false;
    if (chapterId && chapterId !== result.data.chapter_id) return false;
    materialId = result.data.material_id;
  }

  if (chapterId) {
    const result = await supabase.from('chapters').select('id, material_id').eq('id', chapterId).maybeSingle();
    if (result.error || !result.data) return false;
    if (materialId && materialId !== result.data.material_id) return false;
    materialId = result.data.material_id;
  }

  if (materialId) {
    const result = await supabase.from('materials').select('id, subject_id').eq('id', materialId).maybeSingle();
    if (result.error || !result.data) return false;
    if (subjectId && subjectId !== result.data.subject_id) return false;
  } else if (subjectId) {
    const result = await supabase.from('subjects').select('id').eq('id', subjectId).maybeSingle();
    if (result.error || !result.data) return false;
  }
  return true;
}
