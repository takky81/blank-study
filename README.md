# 穴埋め学習アプリ

Markdown で書いたノートの語句を空欄にして、間隔反復で覚えるためのアプリ。

- ノートは章の木で持ち、本文に `{{光合成|id=a3f9k2|tags=生物}}` と書いた箇所が空欄になる
- 出題は選択肢と記述の2形式。定着したものは自動で記述に切り替わる
- 解答の結果は SM-2 相当の計算で次の出題日に反映する
- 教材は zip で書き出し・取り込みができる

## 仕様の在り処

| 何を知りたいか | 見る場所 |
| --- | --- |
| プロダクト共通の方針 | `.kiro/steering/` |
| 機能の要求・設計・実装計画 | `.kiro/specs/<feature>/`（cc-sdd） |
| 移行時点の詳細な回帰ケース | `spec/tables/*.jsonl`（決定表）。`npm run spec` で `spec/dist/index.html` を作る |
| 既存 DB 設計・データ形式・アルゴリズム | [docs/仕様書.md](docs/仕様書.md) |
| 画面の見た目 | `design/` のワイヤーフレーム |
| 開発環境とブランチ運用 | [docs/開発環境.md](docs/開発環境.md) |
| 本番への配信 | [docs/本番デプロイ.md](docs/本番デプロイ.md) |

今後の機能仕様の正は cc-sdd の `.kiro/specs/`。既存の決定表は削除せず、詳細な回帰ケースとテストの対応を保つために使う。振る舞いを変更するときは、承認済み cc-sdd 仕様を先に更新し、必要な決定表・実装・テストを同じ変更で追従させる。

## cc-sdd で機能を変更する

Codex 用の cc-sdd v3 Agent Skills を `.agents/skills/` に導入済み。プロジェクト共通の判断基準は `.kiro/steering/`、既存機能のベースライン仕様と今後の機能仕様は `.kiro/specs/` に置く。

```text
$kiro-discovery <追加・変更したい内容>
$kiro-spec-requirements <feature-name>
$kiro-spec-design <feature-name>
$kiro-spec-tasks <feature-name>
$kiro-impl <feature-name>
```

既存 spec の責務内に収まる変更はその spec を更新する。新しい責務境界が必要な場合だけ、新しい spec を作る。要求 → 設計 → タスクの承認を経てから実装する。

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

既存決定表の列は原則すべてテストで押さえる。`spec:coverage` が 289/289 を下回る変更は、対応する cc-sdd 仕様と一緒に意図を説明すること。

## 配信

`main` に入ると GitHub Pages のサブパスへ配信する（`.github/workflows/deploy.yml`）。
接続先はリポジトリの secrets（`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`）から渡す。

初回に用意するもの（GitHub リポジトリ・Supabase プロジェクト・認証の設定）は
[docs/本番デプロイ.md](docs/本番デプロイ.md) に書いてある。
