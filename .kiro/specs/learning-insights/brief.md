# Brief: learning-insights

## Problem

個人学習者が、教材全体の定着状況、苦手な語句、日々の学習量を把握し、次に学ぶ場所を判断できる必要がある。

## Current State

科目・教材・章の階層集計、未出題／苦手／定着、苦手 keyword、日別解答数・正答率、空状態、大量件数対応が実装済み。決定表 `19-history.jsonl`、`history.spec.ts` と aggregate tests が検証する。

## Desired Outcome

解答ログと keyword stats から導く read model と表示契約を cc-sdd 仕様にし、学習アルゴリズム変更時の再検証先を明確にする。

## Approach

永続データの取得と、階層／日別／苦手の純粋集計を分け、study が所有する定着判定契約を参照する。

## Scope

- **In**: 階層ツリー、開閉、対象 keyword 数、未出題／苦手／定着の分類と割合、今日／今週の復習予定、苦手順、日別解答数・正答数・正答率、履歴なし状態、1000件超の全件集計
- **Out**: 出題そのもの、SRS 更新、グラフライブラリ導入、他利用者との比較

## Boundary Candidates

- HistoryData の取得契約
- 達成度、苦手、日別量の集計
- 階層表示 UI

## Out of Boundary

- 学習通知、目標設定、ランキング、CSV 出力

## Upstream / Downstream

- **Upstream**: learning-content-catalog、adaptive-study-session
- **Downstream**: 将来の分析・学習計画機能

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: study の定着しきい値とログ schema

## Constraints

分類しきい値を study と二重定義しない。削除済み／非活性 keyword の履歴保持方針と所有者境界に従い、ページ上限で集計を欠落させない。
