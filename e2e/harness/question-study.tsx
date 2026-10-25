import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import '../../src/index.css';
import { QuestionStudyRoute, QUESTION_STUDY_ROUTE_DESCRIPTOR } from '../../src/features/questionStudy/QuestionStudyRoute';
import {
  QuestionDistributionRoute, QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR,
} from '../../src/features/questionStudy/QuestionDistributionRoute';
import { supabase } from '../../src/lib/supabase';

/**
 * app-shell登録前の設問学習routeを、本番のSupabase認証sessionと本番APIで描画する。
 * harness URLのqueryをそのままroute queryとして渡す。
 */
function Harness({ signedIn }: { signedIn: boolean }) {
  if (QUESTION_STUDY_ROUTE_DESCRIPTOR.requiresAuth && !signedIn) {
    return <p role="alert" className="p-4">このrouteの表示には認証が必要です。</p>;
  }
  // ?route=distribution で成績分布routeから始める。それ以外のqueryはroute queryとして渡す。
  const query = new URLSearchParams(window.location.search);
  const start = query.get('route') === 'distribution' ? QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR.path : QUESTION_STUDY_ROUTE_DESCRIPTOR.path;
  query.delete('route');
  const search = query.toString();
  return <MemoryRouter initialEntries={[`${start}${search ? `?${search}` : ''}`]}>
    <Routes>
      <Route path={QUESTION_STUDY_ROUTE_DESCRIPTOR.path} element={<QuestionStudyRoute />} />
      <Route path={QUESTION_DISTRIBUTION_ROUTE_DESCRIPTOR.path} element={<QuestionDistributionRoute />} />
      <Route path="*" element={<p>戻り先へ移動しました</p>} />
    </Routes>
  </MemoryRouter>;
}

void supabase.auth.getSession().then(({ data }) => {
  createRoot(document.getElementById('root')!).render(<Harness signedIn={data.session !== null} />);
});
