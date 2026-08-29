import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { isValidEmail, canSubmitLogin, isNetworkFailure } from './validation';

/**
 * ログイン画面。決定表「認証」 spec/tables/01-auth.jsonl に対応する。
 * サインアップ導線は持たない（docs/仕様書.md §2.3）。
 */

/**
 * 資格情報の誤りは、メールが未登録かパスワードが違うかを区別せず同じ文言にする。
 * アカウントの存在を判別させないため（決定表「認証」列2・列3）。
 */
const MESSAGE_INVALID = 'メールアドレスまたはパスワードが違います';
const MESSAGE_NETWORK = '通信に失敗しました。しばらくしてからもう一度お試しください';
const MESSAGE_EMAIL_FORMAT = 'メールアドレスの形式が正しくありません';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 列8: 空欄なら押せない
  const canSubmit = canSubmitLogin(email, password) && !busy;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    // 列7: 形式が不正なら認証を要求せず、入力エラーとして伝える
    if (!isValidEmail(email)) {
      setError(MESSAGE_EMAIL_FORMAT);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      // 列9: 通信の失敗は投げられるとは限らず、エラーとして返ることもある
      if (isNetworkFailure(signInError)) setError(MESSAGE_NETWORK);
      // 列2・列3: 資格情報の誤りは同じ文言でログイン画面にとどまる
      else if (signInError) setError(MESSAGE_INVALID);
    } catch {
      // 列9: 通信の失敗は資格情報の誤りとは別の文言にする
      setError(MESSAGE_NETWORK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-md border-2 border-ink bg-panel p-8"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px]">穴埋め学習</h1>
          <p className="text-[13px] text-muted">ログインしてください</p>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-soft">メールアドレス</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="you@example.com"
            className="field h-[46px]"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-soft">パスワード</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="field h-[46px]"
          />
        </label>

        <div className="flex flex-col gap-2">
          <button type="submit" disabled={!canSubmit} className="btn-p h-[46px] text-[16px]">
            {busy ? '確認しています…' : 'ログイン'}
          </button>
          <p role="alert" className="min-h-5 text-[13px] text-warn">
            {error}
          </p>
        </div>
      </form>
    </div>
  );
}
