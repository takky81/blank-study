import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { LoginPage } from '@/features/auth/LoginPage';

/**
 * セッションの有無で画面を振り分ける。
 * 未ログインで保護された画面を開いてもログイン画面に戻る（決定表「認証」列4）。
 * セッションが切れた場合も同じ（列10）。
 */
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => subscription.subscription.unsubscribe();
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

  return (
    <div className="min-h-dvh bg-stone-50 dark:bg-stone-950 dark:text-stone-100">
      <header className="flex h-14 items-center gap-4 border-b-2 border-stone-900 bg-white px-6 dark:border-stone-100 dark:bg-stone-900">
        <span className="text-lg">穴埋め学習</span>
        <span className="grow" />
        <span className="text-xs text-stone-500">{session.user.email}</span>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="h-8 rounded border border-stone-400 px-3 text-sm text-stone-600 dark:text-stone-300"
        >
          ログアウト
        </button>
      </header>
      <main className="p-10">
        <p className="text-sm text-stone-500">
          科目一覧はこれから作る。決定表「科目の管理」に対応させる。
        </p>
      </main>
    </div>
  );
}
