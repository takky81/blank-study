# Brief: app-shell-and-responsive-experience

## Problem

個人学習者が、画面幅やテーマにかかわらず迷わず操作でき、読み込み・失敗・消失 URL の状態でもアプリが壊れない必要がある。

## Current State

共通ヘッダ、パンくず、モバイル下部ナビ、操作メニュー、ライト／ダークテーマ、レスポンシブダイアログ、再試行、SPA フォールバックが実装済み。決定表 `20-ui.jsonl` と `e2e/ui.spec.ts` が主要挙動を検証する。

## Desired Outcome

各機能 spec が再利用する画面シェルと適応 UI の契約を明文化し、新機能でも同じ操作品質を維持する。

## Approach

業務画面の内容ではなく、ルーティング、共通ナビゲーション、表示状態、操作領域、テーマ、サブパス配信を所有する横断 spec とする。

## Scope

- **In**: 保護画面のルート、共通ヘッダ・パンくず・モバイルナビ、テーマ保存、広幅／狭幅の切替、共通ダイアログと行操作、読み込み／空／失敗の区別、再試行、404 相当の復帰、ブラウザ戻る、コントラストと操作領域
- **Out**: ログイン資格情報の判定、個別業務画面のデータ規則、ワイヤーフレームの全面改訂

## Boundary Candidates

- `App` が所有するルーティングと共通レイアウト
- 共通 UI component と CSS token

## Out of Boundary

- 各 feature 固有の操作フローと文言

## Upstream / Downstream

- **Upstream**: identity-and-access、ブラウザ、GitHub Pages
- **Downstream**: すべての画面 spec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: すべての feature UI

## Constraints

Vite `base` と Router `basename` を同期する。狭幅の主要操作は 44px 以上、ライト／ダーク双方で既存コントラスト基準を満たす。
