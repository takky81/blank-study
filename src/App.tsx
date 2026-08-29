import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { LoginPage } from '@/features/auth/LoginPage';
import { SubjectsPage } from '@/features/subjects/SubjectsPage';
import { MaterialsPage } from '@/features/materials/MaterialsPage';
import { EditorPage } from '@/features/editor/EditorPage';
import { StudyPage } from '@/features/study/StudyPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { loadTheme, nextTheme, resolveTheme, saveTheme, type Theme } from '@/lib/theme';
import { useNarrow } from '@/lib/useNarrow';

/**
 * セッションの有無で画面を振り分ける。
 * 未ログインで保護された画面を開いてもログイン画面に戻る（決定表「認証」列4・列10）。
 */
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(loadTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches),
  );
  const narrow = useNarrow();

  // 選んだ側を <html> に反映する（決定表「表示設定と共通の振る舞い」列1・列2・列3）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

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
          <Link to="/history" className="text-sm text-stone-600 dark:text-stone-300">
            学習履歴
          </Link>
          <span className="grow" />
          <span className="hidden text-xs text-stone-500 sm:inline">{session.user.email}</span>
          <button
            type="button"
            aria-label="テーマを切り替える"
            onClick={() => {
              const next = nextTheme(theme);
              setTheme(next);
              saveTheme(next);
            }}
            className="h-11 w-11 rounded border border-stone-400 text-stone-600 dark:text-stone-300"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="h-11 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
          >
            ログアウト
          </button>
        </header>
        <main className={narrow ? 'pb-16' : ''}>
          <Routes>
            <Route path="/" element={<SubjectsPage />} />
            <Route path="/subjects/:subjectId" element={<MaterialsPage />} />
            <Route path="/materials/:materialId/edit" element={<EditorPage />} />
            <Route path="/materials/:materialId/study" element={<StudyPage />} />
            <Route path="/subjects/:subjectId/study" element={<StudyPage />} />
            <Route path="/history" element={<HistoryPage />} />
            {/* 列13: 存在しない URL は一覧へ戻す */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {/* 狭い画面では下に学習と履歴のタブを出す（決定表「表示設定と共通の振る舞い」列5） */}
        <nav
          data-testid="mobile-nav"
          hidden={!narrow}
          className="fixed inset-x-0 bottom-0 z-30 flex border-t-2 border-stone-900 bg-white dark:border-stone-100 dark:bg-stone-900"
        >
          <Link to="/" className="flex h-14 grow items-center justify-center text-sm">
            学習
          </Link>
          <Link to="/history" className="flex h-14 grow items-center justify-center text-sm">
            履歴
          </Link>
        </nav>
      </div>
    </BrowserRouter>
  );
}
