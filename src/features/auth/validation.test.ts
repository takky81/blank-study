import { describe, it, expect } from 'vitest';
import { isValidEmail, canSubmitLogin } from './validation';

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
