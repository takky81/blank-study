import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { LoginPage } from '@/features/auth/LoginPage';
import { SubjectsPage } from '@/features/subjects/SubjectsPage';

/**
 * セッションの有無で画面を振り分ける。
 * 未ログインで保護された画面を開いてもログイン画面に戻る（決定表「認証」列4・列10）。
 */
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  // 読み込み中と空を取り違えない（決定表「表示設定と共通の振る舞い」列9）
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-50 text-sm text-stone-500 dark:bg-stone-950">
        読み込んでいます…
      </div>
    );
  }

  if (!session) return <LoginPage />;

  // GitHub Pages のサブパスでも解決できるよう Vite の base に合わせる
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div className="min-h-dvh bg-stone-50 dark:bg-stone-950 dark:text-stone-100">
        <header className="flex h-14 items-center gap-4 border-b-2 border-stone-900 bg-white px-6 dark:border-stone-100 dark:bg-stone-900">
          <Link to="/" className="text-lg">
            穴埋め学習
          </Link>
          <span className="grow" />
          <span className="hidden text-xs text-stone-500 sm:inline">{session.user.email}</span>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="h-9 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
          >
            ログアウト
          </button>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<SubjectsPage />} />
            <Route
              path="/subjects/:subjectId"
              element={
                <p className="p-10 text-sm text-stone-500">
                  教材一覧はこれから作る。決定表「教材の管理」に対応させる。
                </p>
              }
            />
            {/* 列13: 存在しない URL は一覧へ戻す */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
