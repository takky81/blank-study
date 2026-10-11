# Brief: structured-question-study

## Problem

個人学習者は、keyword の穴埋めだけでなく、独立した問題文と模範解答を持つ設問で理解を確認したい。既存の穴埋め履歴・正答率・SRSへ混ぜると、異なる難度と出題形式の成績が互いに影響し、設問単位の改善判断ができない。

## Current State

`adaptive-study-session` は keyword の穴埋めについて選択式、記述式、自動切替、正誤判定、別解、SRS、履歴記録を所有する。構造化設問に専用の stats／answer logs、原子的記録 RPC、結果画面の見直しフラグ操作は存在しない。

## Desired Outcome

- 構造化設問を既存穴埋めと同様に選択式・記述式・習熟度による自動切替で解ける。
- 設問ごとに正誤、出題回数、正答率、SRS 状態を記録する。
- 穴埋めの履歴、正答率、SRSとは完全に分離する。
- 結果表示時に疑義フラグまたは解説追加フラグを設定できる。
- 履歴と SRS の更新は部分成功を残さない。

## Approach

question FK を持つ専用 question stats と question answer logs を追加し、単一 PostgreSQL RPC で履歴追加と SRS 更新を原子的に行う。出題形式と SRS の基礎計算は `adaptive-study-session` の共有可能な純粋契約を消費するが、テーブル、集計、画面状態、進捗は本仕様が所有する。

## Scope

- **In**: 対象範囲選択、設問順序、選択肢生成、選択式、記述式、自動切替、厳密な正誤判定、結果表示、設問フラグ更新、専用履歴・正答率・SRS、原子的記録、再試行、1,000件超候補
- **Out**: 穴埋め履歴との合算、AI採点、部分一致・意味類似判定、設問本文の通常編集、AI用ファイル交換

## Boundary Candidates

- 構造化設問の候補射影と出題順
- 選択／記述／自動切替の形式決定
- 専用正誤判定、question stats、question answer logs
- 履歴と SRS の原子的記録 RPC
- 結果表示と question-bank のフラグ更新 adapter

## Out of Boundary

- question マスタと版管理
- 穴埋め用 `keyword_stats`／`answer_logs` の変更
- 外部 AI の呼出し、ファイル schema、import conflict
- learning insights への統合表示（別途要求が出た場合に追加する）

## Upstream / Downstream

- **Upstream**: `structured-question-bank` の設問マスタ、`adaptive-study-session` の共有可能な形式・正規化・SRS基礎規則、`identity-and-access` の4主体セキュリティ契約、`learning-content-catalog` の階層・ページング
- **Downstream**: `question-generation-exchange` が誤答数、出題回数、正答率を抽出条件として利用する

## Existing Spec Touchpoints

- **Extends**: なし。穴埋め学習を変更せず、別の学習境界を追加する
- **Adjacent**: `adaptive-study-session` の式とUIパターンは利用するが、既存テーブル・履歴・セッションへ書き込まない。`learning-insights` への表示は初期範囲外

## Constraints

- 穴埋めと構造化設問の成績を同じ行・集計へ混ぜない
- RPC は `SECURITY INVOKER`、空 `search_path`、schema 修飾、anon revoke、owner/cross-owner/anon/service-role 回帰を満たす
- 履歴と SRS 更新は単一トランザクションで成功または失敗する
- service role は E2E の準備・事後確認だけに使う
- 出題対象は安定した一意順で全ページ取得する
