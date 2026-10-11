# Brief: identity-and-access

## Problem

管理者からアカウントを与えられた個人学習者が、自分の教材と学習履歴だけへ安全にアクセスできる必要がある。

## Current State

Supabase Auth のメールアドレス／パスワード認証、セッション監視、ログアウト、全データテーブルの RLS と権限が実装済み。決定表 `01-auth.jsonl` と `e2e/auth.spec.ts` が振る舞いを検証する。

## Desired Outcome

認証と所有者分離の現在の契約を、今後の全 spec が依存できる承認済み cc-sdd 仕様として固定する。

## Approach

利用者に見える認証フローと、DB による所有者境界を同じ security boundary として記述する。アプリの一般ルーティングやレスポンシブ外観は隣接 spec に委ねる。

## Scope

- **In**: ログイン入力検証、認証失敗と通信失敗の区別、セッション復元・失効、ログアウト、未認証保護、サインアップ非提供、RLS、DB 権限、公開キーの前提
- **Out**: 共通ヘッダ、テーマ、教材 CRUD、管理者によるアカウント作成 UI

## Boundary Candidates

- Supabase Auth とフロントエンドのセッション境界
- `owner_id = auth.uid()` によるデータ境界

## Out of Boundary

- パスワード再設定、多要素認証、公開登録、共同利用

## Upstream / Downstream

- **Upstream**: Supabase Auth
- **Downstream**: すべての保護画面とデータアクセス spec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: app-shell-and-responsive-experience

## Constraints

ブラウザには publishable/anon key のみを渡す。service role は E2E 準備以外に使わない。未ログイン時は DB テーブルと RPC を利用できない。
