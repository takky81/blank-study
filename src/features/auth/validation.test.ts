import { describe, it, expect } from 'vitest';
import { isValidEmail, canSubmitLogin, isNetworkFailure } from './validation';

// 決定表「認証」 spec/tables/01-auth.jsonl
describe('ログインフォームの検査', () => {
  it('列7 validateLoginForm: メール形式を検査する', () => {
    expect(isValidEmail('dev@example.test')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@example.test')).toBe(false);
    expect(isValidEmail('@example.test')).toBe(false);
  });

  it('列7 前後の空白は落としてから判定する', () => {
    expect(isValidEmail('  dev@example.test  ')).toBe(true);
  });

  it('列8 validateLoginForm: 空欄を弾く', () => {
    expect(canSubmitLogin('', 'password')).toBe(false);
    expect(canSubmitLogin('dev@example.test', '')).toBe(false);
    expect(canSubmitLogin('   ', 'password')).toBe(false);
    expect(canSubmitLogin('dev@example.test', 'password')).toBe(true);
  });

  it('列8 形式が不正でも入力が揃っていれば押せる（押した先で形式を伝える）', () => {
    expect(canSubmitLogin('not-an-email', 'password')).toBe(true);
  });
});

// 決定表「認証」列9: 通信の失敗は資格情報の誤りと区別する
describe('認証エラーの区別', () => {
  it('列9 通信に届かなかった失敗は通信の失敗として扱う', () => {
    expect(isNetworkFailure({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    expect(isNetworkFailure({ name: 'AuthRetryableFetchError' })).toBe(true);
    expect(isNetworkFailure({ name: 'TypeError', message: 'Failed to fetch' })).toBe(true);
    expect(isNetworkFailure({ name: 'AuthApiError', status: 0 })).toBe(true);
  });

  it('列2・列3 サーバーが返した資格情報の誤りは通信の失敗ではない', () => {
    expect(isNetworkFailure({ name: 'AuthApiError', status: 400 })).toBe(false);
    expect(isNetworkFailure({ name: 'AuthApiError', status: 401 })).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});
