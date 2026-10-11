import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import '../../src/index.css';
import { QuestionExchangeRoute, QUESTION_EXCHANGE_ROUTE_DESCRIPTOR } from '../../src/features/questionExchange/QuestionExchangeRoute';
import { supabase } from '../../src/lib/supabase';

/**
 * app-shell登録前の設問交換routeを、本番のSupabase認証sessionと本番APIで描画する。
 * harness URLのqueryをそのままroute queryとして渡す。
 */
function Harness({ signedIn }: { signedIn: boolean }) {
  if (QUESTION_EXCHANGE_ROUTE_DESCRIPTOR.requiresAuth && !signedIn) {
    return <p role="alert" className="p-4">このrouteの表示には認証が必要です。</p>;
  }
  return <MemoryRouter initialEntries={[`${QUESTION_EXCHANGE_ROUTE_DESCRIPTOR.path}${window.location.search}`]}>
    <Routes>
      <Route path={QUESTION_EXCHANGE_ROUTE_DESCRIPTOR.path} element={<QuestionExchangeRoute />} />
      <Route path="*" element={<p>戻り先へ移動しました</p>} />
    </Routes>
  </MemoryRouter>;
}

void supabase.auth.getSession().then(({ data }) => {
  createRoot(document.getElementById('root')!).render(<Harness signedIn={data.session !== null} />);
});
