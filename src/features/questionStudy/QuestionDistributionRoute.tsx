import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { QuestionDistributionPage } from './QuestionDistributionPage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STUDY_PATH = '/question-study';

type LocalFeatureRouteDescriptor = {
  id: string;
  path: string;
  element: React.ReactElement;
  requiresAuth: true;
};

/** 成績分布は設問学習の範囲選択から開く画面なので、共通navigationには項目を持たない。 */
export const QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR = {
  id: 'questions.study.distribution',
  path: '/question-study/distribution',
  element: <QuestionDistributionRoute />,
  requiresAuth: true,
} satisfies LocalFeatureRouteDescriptor;

/**
 * 科目単位の成績分布pageのroute adapter。
 * subjectIdが不正ならpageを描画しないため、集計の読込は始まらない。
 */
export function QuestionDistributionRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const subjectId = useMemo(() => parseSubjectId(location.search), [location.search]);

  if (subjectId === null) {
    return <main className="mx-auto flex max-w-4xl flex-col items-start gap-4 p-6">
      <h1 className="text-[22px]">成績分布</h1>
      <p role="alert">成績分布を開けません。指定内容を確認してください。</p>
      <button type="button" className="btn" onClick={() => navigate(STUDY_PATH, { replace: true })}>範囲選択へ戻る</button>
    </main>;
  }

  return <QuestionDistributionPage
    key={subjectId}
    subjectId={subjectId}
    onExit={() => navigate(`${STUDY_PATH}?subjectId=${subjectId}`)}
  />;
}

function parseSubjectId(search: string): string | null {
  const values = new URLSearchParams(search).getAll('subjectId');
  if (values.length !== 1) return null;
  const [value] = values;
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}
