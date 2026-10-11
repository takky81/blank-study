# 調査記録と設計判断

## 概要

- **機能**: `app-shell-and-responsive-experience`
- **ディスカバリ範囲**: 既存機能の拡張に対する軽量ディスカバリ
- **主要な確認結果**:
  - 認証後のルート、共通ヘッダー、パンくず、テーマ、狭幅ナビゲーションは `src/App.tsx` と小さな共通モジュールへ集約されている。
  - 読み込み、空、失敗、再試行、不存在は共通コンポーネントではなく、各業務画面が同じ表示契約を個別実装している。
  - 決定表21列の多くはコード、Vitest、Playwright へ対応するが、実配信サブパス、キーボード操作、全画面の44px操作領域には未検証範囲が残る。

## 調査ログ

### ルーティングとシェル境界

- **背景**: 認証後の全画面が共有する責務と `identity-and-access` の責務を分離した。
- **参照元**: `src/App.tsx`、`src/components/Trail.tsx`、`src/features/*/*Page.tsx`、`.kiro/specs/identity-and-access/design.md`、`e2e/ui.spec.ts`
- **確認結果**:
  - `App` はセッション確定後だけ Router と共通シェルを構築し、6つの既存 URL を業務画面へ接続する。
  - 未知のアプリ内 URL は通知を出さず `/` へ置換遷移する。消失した業務データ ID は各画面が「見つからない」表示と一覧導線を出すため、両者は異なる契約である。
  - `TrailProvider` は画面から `Crumb[]` を受け、上位要素をリンク、末尾を現在地として表示する。
- **設計への影響**: セッションの有効性は上流仕様へ委ね、本仕様は認証済み領域の Router、共通レイアウト、URL フォールバックだけを所有する。業務データの不存在判定は各 feature に残す。

### 適応レイアウトとワイヤーフレーム

- **背景**: 「広幅／狭幅」を現行実装のどの境界へ対応させるか確認した。
- **参照元**: `src/lib/useNarrow.ts`、`src/App.tsx`、`src/components/RowActions.tsx`、`src/components/ConfirmDialog.tsx`、`src/components/ConflictDialog.tsx`、`src/features/editor/KeywordDialog.tsx`、`design/canvas.json`、`design/*.dc.html`、`e2e/ui.spec.ts`
- **確認結果**:
  - シェルと行操作は 767px 以下を狭幅とし、画面幅変更イベントへ追従する。
  - ダイアログは Tailwind の `sm` 境界を使い、639px 以下で全幅の下端シート、640px 以上で中央表示になる。したがって 640〜767px ではモバイルナビと中央ダイアログが併存する。
  - ページ内の列構成には `lg` 境界もあり、レスポンシブは単純な二値ではない。
  - ワイヤーフレームは 1180×800 と 390×844 の代表状態を示し、実装の中間幅すべてを定義するものではない。
- **設計への影響**: シェルのナビゲーション境界、ダイアログ境界、業務画面固有境界を別契約として扱う。編集3ペインや学習本文高さは下流仕様へ残す。

### テーマ、配色、操作状態

- **背景**: ライト／ダークテーマと共通操作品質の実装証拠を確認した。
- **参照元**: `src/lib/theme.ts`、`src/lib/theme.test.ts`、`src/index.css`、`src/lib/contrast.ts`、`src/lib/contrast.test.ts`、`src/lib/submitGuard.ts`、`src/lib/submitGuard.test.ts`、`e2e/ui.spec.ts`
- **確認結果**:
  - 未保存時は初期化時の OS 設定を使い、保存済み設定を優先する。OS の配色変更へ実行中に追従する契約はない。
  - storage の読書き失敗と壊れた値は、起動または表示切替を止めない。
  - 色はライト／ダーク双方で同じ CSS token 名を使う。選定済みの文字ペアは4.5:1、輪郭ペアは3:1、面の濃度順はユニットテストで固定される。
  - 共通ボタン class は高さ44px、フォーカス輪郭とホバー変化は全体 CSS で定義される。カード内ボタンのホバー中は親カードのホバーを抑止する。
  - `createSubmitGuard` は並行実行を捨て、成功・失敗のどちらでも busy を解除する。業務画面にも同じ busy ガードがある。
- **設計への影響**: 新しい状態管理やデザイントークン層を追加せず、既存の小さな純粋関数と CSS token を正とする。全業務操作の状態機械は所有せず、共通品質契約だけを固定する。

### 表示状態と復帰

- **背景**: 読み込み、空、失敗、再試行、不存在が共有可能な挙動かを確認した。
- **参照元**: `src/features/subjects/SubjectsPage.tsx`、`src/features/materials/MaterialsPage.tsx`、`src/features/editor/EditorPage.tsx`、`src/features/history/HistoryPage.tsx`、`src/features/study/StudyPage.tsx`、`e2e/ui.spec.ts`
- **確認結果**:
  - 各画面は `loading` を先に判定し、成功後の0件だけを空状態にする。
  - 失敗は `role="alert"` と再試行を表示し、同じ `load` 関数を実行し直す。
  - 消失 ID の判定と戻り先は業務画面が所有する。シェルは共通の表示最低条件を規定するが、文言や問い合わせは所有しない。
- **設計への影響**: 現時点で共通表示コンポーネントを新設しない。下流画面が満たす `DisplayStateContract` として設計し、将来共通化する場合も業務状態の所有権を移さない。

### サブパス配信

- **背景**: GitHub Pages 上の直接 URL と再読み込みの成立条件を確認した。
- **参照元**: `vite.config.ts`、`src/App.tsx`、`.github/workflows/deploy.yml`、`e2e/ui.spec.ts`
- **確認結果**:
  - production build の base は `/blank-study/`、Router の basename は `import.meta.env.BASE_URL` であり、同じ生成値を利用する。
  - 配信 workflow は `dist/index.html` を `dist/404.html` に複製して SPA フォールバックを作る。
  - 現行 E2E は開発時 base `/` だけを確認し、実際の `/blank-study/` と 404 フォールバック経由の直リンクは検証していない。
- **設計への影響**: base、basename、404 フォールバックを一体の `SubpathDeployment` 境界として扱い、production 相当の未検証項目をタスクへ残す。

## アーキテクチャパターン評価

| 選択肢 | 概要 | 強み | リスク／制約 | 判断 |
|---|---|---|---|---|
| 現行の薄いシェルと共通部品を維持 | `App` が配線し、theme・幅判定・UI 部品・CSS を小さく共有する | 既存構造と一致し、業務 feature の所有権を侵食しない | 表示状態の実装重複は残る | 採用 |
| 全表示状態を共通コンポーネント化 | loading／empty／error／not-found を単一部品へ集約する | 見た目を統一しやすい | 現行にない抽象化と文言所有を導入する | 不採用 |
| UI フレームワークを追加 | ダイアログ、テーマ、レスポンシブを外部ライブラリへ移す | 高機能な部品を利用できる | 新依存と全面的な見た目変更になりベースラインを越える | 不採用 |

## 設計判断

### 判断: シェル所有と業務画面所有を分離する

- **背景**: ナビゲーションは横断的だが、データの空・失敗・不存在の判定は各 feature の問い合わせ結果に依存する。
- **代替案**:
  1. シェルが各 feature の状態と文言まで所有する。
  2. シェルは表示最低契約だけを定義し、判定と文言は各 feature に残す。
- **採用案**: 2を採用し、`DisplayStateContract` を下流が実装する契約として定義する。
- **理由**: 現行コードと feature-first 構造を保ち、共有 UI から業務型や API への依存を作らない。
- **トレードオフ**: 同型の表示コードは残るが、責務と変更理由が明確になる。
- **追跡事項**: 複数 feature が完全に同じ状態・文言を共有する変更時にだけ共通コンポーネント化を再評価する。

### 判断: レスポンシブ境界を用途別に固定する

- **背景**: 現行コードはシェル、ダイアログ、業務レイアウトで異なる CSS 境界を使う。
- **採用案**: シェル操作は 768px、共通ダイアログは 640px、業務画面固有配置は各 feature の境界とする。
- **理由**: 1つの架空のブレークポイントへ統一せず、実際に利用者が観測する挙動を表現できる。
- **トレードオフ**: 中間幅の見え方を個別に検証する必要がある。
- **追跡事項**: Tailwind breakpoint または `useNarrow` の既定 query を変更した場合、共通部品と下流 UI を再検証する。

### 判断: プラットフォームと既存ライブラリを採用し新しい UI 基盤を作らない

- **背景**: React Router、MediaQuery、localStorage、CSS custom properties、GitHub Pages fallback で現在の要件を満たしている。
- **採用案**: 現行機能を維持し、新規ルーター、テーマ管理、ダイアログ管理、CSS-in-JS を導入しない。
- **理由**: ベースライン仕様化に必要な追加実装がなく、設計を最小に保てる。
- **トレードオフ**: focus trap や OS テーマ変更追従など、現行にない高度な挙動は提供しない。
- **追跡事項**: アクセシビリティ要件を拡張する場合は ConfirmDialog と ConflictDialog の契約差を先に解消する。

## リスクと緩和策

- ダイアログとシェルで狭幅境界が異なる — 用途別の境界を設計とテスト名へ明記し、640〜767pxを単一状態と誤認しない。
- 44px検証が教材一覧の可視ボタンに限られる — 共通ボタンと代表的な下流画面を横断する未完了検証タスクを残す。
- 確認ダイアログの初期フォーカス／Escape、操作メニューの外側クリック／Escape に自動テストがない — DOM テストまたはE2Eの未完了項目として追跡する。
- production サブパスと 404 フォールバックが実配信条件で未検証 — production build／preview 相当の統合テストを未完了項目として追跡する。
- コントラスト試験は選定 token ペアだけを対象とする — 新しい token または組み合わせを追加する際、テスト対象ペアも同じ変更で更新する。

## 横断レビュー追補（2026-10-10）

- `ConflictDialog` が transfer の業務型を import しており、共有 UI から下流 feature への逆依存があった。共通表示型を component 側へ置き、editor／portability は adapter を所有する設計へ変更した。
- `submitGuard`、共通 dialog、行操作は本仕様が単一所有し、下流 Page は業務状態と統合テストだけを所有する。`RoutePages` のような広いファイル境界は task から除いた。

## 参照

- `.kiro/steering/product.md` — モバイル、テーマ、コントラストのプロダクト原則
- `.kiro/steering/tech.md` — Vite base、Router basename、UI・テスト標準
- `.kiro/steering/structure.md` — 共通 UI と下流 feature の依存方向
- `.kiro/specs/app-shell-and-responsive-experience/brief.md`、`.kiro/steering/roadmap.md` — 発見時の範囲と依存関係
- `spec/tables/20-ui.jsonl` — 21列の既存回帰決定表
- `design/canvas.json`、`design/*.dc.html` — デスクトップ／スマートフォンの参照ワイヤーフレーム
- `src/App.tsx`、`src/components/`、`src/lib/theme.ts`、`src/lib/useNarrow.ts`、`src/lib/submitGuard.ts`、`src/index.css` — 現行実装
- `src/lib/theme.test.ts`、`src/lib/contrast.test.ts`、`src/lib/submitGuard.test.ts`、`e2e/ui.spec.ts` — 自動テスト証拠
- `vite.config.ts`、`.github/workflows/deploy.yml` — サブパス build と SPA フォールバック
