# Brief: adaptive-study-session

## Problem

個人学習者が教材の文脈を使って効率よく復習し、習熟度に応じた難度と次回復習日を得られる必要がある。

## Current State

科目／教材／章範囲、出現順／自動順、選択／記述／自動形式、選択肢生成、文脈表示、正誤判定、別解、SM-2 相当、解答ログ、セッション結果が実装済み。決定表 `12`〜`18` と study tests が検証する。

## Desired Outcome

1問の選定から記録、次問、終了までの状態機械と学習アルゴリズムを、将来の出題機能が依存できる仕様として固定する。

## Approach

候補抽出、順序、形式、選択肢、表示、判定、SRS を純粋関数として分離し、画面がセッション状態と永続化を統合する現在の設計を反映する。

## Scope

- **In**: 対象範囲、候補順、未出題／期限／直近回避、自動形式、誤答候補、固定「わからない」、表示範囲拡張と伏せ字、正規化完全一致、別解登録、解答ログ、成績、SM-2、誤答の再出題、終了・中断、記録失敗時の継続、1000件超
- **Out**: 教材編集、履歴ダッシュボード、音声・手書き・AI 採点

## Boundary Candidates

- StudyData から候補を作る read model
- 質問生成と判定の純粋契約
- 1問ごとの記録と SRS 更新
- 学習セッション状態機械

## Out of Boundary

- 学習計画の通知、複数人ランキング、採点後の教材自動生成

## Upstream / Downstream

- **Upstream**: learning-content-catalog、markdown-keyword-authoring
- **Downstream**: learning-insights

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: history は同じ定着しきい値と解答ログを読む

## Constraints

定着は3回以上かつ90%以上。選択肢は正答1件と誤答3件に固定の「わからない」を加える。直近10件を連続出題回避に使い、SRS は現在時刻基準で更新する。
