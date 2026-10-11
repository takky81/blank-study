# 技術スタック

## アーキテクチャ

React のクライアント側 SPA が Supabase Auth、PostgREST、RPC を直接利用する。画面は GitHub Pages に静的配信し、認証・永続化・集計・トランザクションは Supabase/PostgreSQL が担う。専用アプリサーバーは持たない。

## コア技術

- **言語**: TypeScript 5.9、ESM、ES2022
- **実行環境**: Node.js 24 系、ブラウザ
- **フロントエンド**: React 19、React Router 7、Vite 7
- **UI**: Tailwind CSS 4、CSS カスタムプロパティ
- **データ／認証**: Supabase JS 2、PostgreSQL 17、Supabase Auth
- **テスト**: Vitest 3、Testing Library、Playwright 1.56
- **配信**: GitHub Actions、GitHub Pages、Supabase Cloud

## 実装標準

### 型安全

- `strict`、`noUncheckedIndexedAccess`、未使用検査を維持し、`any` を導入しない
- 型だけの import は `import type` または `type` 修飾を使う
- DB の `snake_case` 行は feature の API 境界で `camelCase` のアプリ型へ変換する
- スキーマ変更時は API 型、マッピング、テストを同時に更新する

### 状態とドメインロジック

- 画面固有状態は React state に置き、横断状態を最小限にする
- パース、検証、順序、集計、SRS、突合は副作用のない関数として分離する
- DB 操作は feature の `api.ts` に集約し、失敗は操作文脈を含む日本語 `Error` として返す
- 独立した読み取りや更新は、安全な場合に `Promise.all` で並列化する
- 二重送信防止、楽観更新のロールバック、再試行可能なエラー表示を既存パターンに合わせる

### データとセキュリティ

- 全ユーザーデータは `owner_id` を持ち、RLS の `USING` と `WITH CHECK` の両方で `auth.uid()` に制限する
- ブラウザには公開前提の publishable/anon key だけを渡し、`service_role` は本番フロントや Actions に置かない
- RPC は原則 `SECURITY INVOKER` とし、`search_path = ''` とスキーマ修飾を使う
- 複数テーブルの原子的更新は PostgreSQL RPC の単一トランザクションへ寄せる
- 既存マイグレーションは変更せず、新しいタイムスタンプ付きマイグレーションを追加する
- 後戻りしにくいスキーマ変更は、追加・併用・削除の互換期間を設ける

### 件数と性能

- Supabase の 1 回 1,000 行上限を前提にする
- 件数・集計は DB 側で行い、全行が必要な処理は共通ページングで取得し切る
- 問い合わせパターンに合わせて B-tree / GIN index を設ける
- 大量データ対応は「エラーにならない」ではなく「欠落しない」ことをテストする

### UI

- Vite の `base` と Router の `basename` を常に同期し、GitHub Pages のサブパス配信を保つ
- 色と共通部品の見た目は CSS トークン／共通 class に集約する
- キーボード focus、44px 相当の操作領域、ライト／ダーク両テーマのコントラストを維持する
- 既存ワイヤーフレームとレスポンシブの広幅／狭幅パターンに合わせる

## テストと品質ゲート

- 純粋ロジックは対象モジュールの隣に Vitest を置く
- 利用者経路、RLS、DB 副作用、レスポンシブ UI は Playwright とローカル Supabase で検証する
- E2E は共有 DB を使うため直列実行する。本番 DB に接続しない
- 振る舞い変更では、cc-sdd 仕様、必要な決定表、実装、ユニット／E2E テストを同期する
- 通常の品質ゲートは型検査、ユニットテスト、決定表カバレッジ、production build。画面・DB・振る舞い変更時は E2E も必須とする

## 開発環境

```bash
npm ci
npm run db:start
npm run dev
npm run typecheck
npm test
npm run spec:coverage
npm run build
npm run test:e2e
```

ローカル DB には Docker が必要。環境変数は `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` または互換名 `VITE_SUPABASE_ANON_KEY` を使う。`VITE_` 変数は成果物へ埋め込まれるため、秘密情報を置かない。

---
_採用技術と変更時の判断基準を記録し、依存パッケージの網羅表にはしない。_
