# 穴埋め学習アプリ

Markdown で書いたノートの語句を空欄にして、間隔反復で覚えるためのアプリ。

- ノートは章の木で持ち、本文に `{{光合成|id=a3f9k2|tags=生物}}` と書いた箇所が空欄になる
- 出題は選択肢と記述の2形式。定着したものは自動で記述に切り替わる
- 解答の結果は SM-2 相当の計算で次の出題日に反映する
- 教材は zip で書き出し・取り込みができる

## 仕様の在り処

| 何を知りたいか | 見る場所 |
| --- | --- |
| 機能の振る舞い | `spec/tables/*.jsonl`（決定表）。`npm run spec` で `spec/dist/index.html` を作る |
| DB 設計・データ形式・アルゴリズム | [docs/仕様書.md](docs/仕様書.md) |
| 画面の見た目 | `design/` のワイヤーフレーム |
| 開発環境とブランチ運用 | [docs/開発環境.md](docs/開発環境.md) |
| 本番への配信 | [docs/本番デプロイ.md](docs/本番デプロイ.md) |

決定表が機能の正。仕様書には決定表で表せないものだけを書く。

## 動かす

```bash
npm ci
npm run db:start      # ローカルの Supabase（Docker が要る）
npm run dev
```

`.env.local` に接続先を書く。ローカルの値は `npm run db:status` で確認できる。

```text
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=...
```

## 確かめる

```bash
npm run typecheck     # 型
npm test              # ユニットテスト
npm run test:e2e      # E2E（ローカルの Supabase を使う）
npm run spec:coverage # 決定表の列がテストで押さえられているか
```

決定表の列は原則すべてテストで押さえる。`spec:coverage` が 287/287 を保つこと。

## 配信

`main` に入ると GitHub Pages のサブパスへ配信する（`.github/workflows/deploy.yml`）。
接続先はリポジトリの secrets（`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`）から渡す。

初回に用意するもの（GitHub リポジトリ・Supabase プロジェクト・認証の設定）は
[docs/本番デプロイ.md](docs/本番デプロイ.md) に書いてある。
