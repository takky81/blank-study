import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import '../../src/index.css';
import { QuestionStudyRoute, QUESTION_STUDY_ROUTE_DESCRIPTOR } from '../../src/features/questionStudy/QuestionStudyRoute';
import { supabase } from '../../src/lib/supabase';

/**
 * app-shell登録前の設問学習routeを、本番のSupabase認証sessionと本番APIで描画する。
 * harness URLのqueryをそのままroute queryとして渡す。
 */
function Harness({ signedIn }: { signedIn: boolean }) {
  if (QUESTION_STUDY_ROUTE_DESCRIPTOR.requiresAuth && !signedIn) {
    return <p role="alert" className="p-4">このrouteの表示には認証が必要です。</p>;
  }
  return <MemoryRouter initialEntries={[`${QUESTION_STUDY_ROUTE_DESCRIPTOR.path}${window.location.search}`]}>
    <Routes>
      <Route path={QUESTION_STUDY_ROUTE_DESCRIPTOR.path} element={<QuestionStudyRoute />} />
      <Route path="*" element={<p>戻り先へ移動しました</p>} />
    </Routes>
  </MemoryRouter>;
}

void supabase.auth.getSession().then(({ data }) => {
  createRoot(document.getElementById('root')!).render(<Harness signedIn={data.session !== null} />);
});
