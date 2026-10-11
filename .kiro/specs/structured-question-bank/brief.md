# Brief: structured-question-bank

## Problem

個人学習者は、Markdown 本文の穴埋めとは別に、キーワードを対象とした設問文・模範解答・選択肢・解説の組を作りたい。現状は keyword に対する構造化設問を複数保持するマスタ、通常編集、見直し要求を記録する仕組みがない。

## Current State

既存 keyword は教材内文書 ID、正答、タグ、誤答選択肢、活性状態、provenance を持ち、章所属は本文中の出現から求める。穴埋め問題は本文から生成されるが、独立した設問文や解説を持つ設問エンティティは存在しない。

## Desired Outcome

- 1つの keyword に0件以上の設問を紐付けられる。
- 1つの設問は1つの keyword だけを対象にする。
- 設問文、模範解答、選択肢、解説を作成・表示・編集・削除できる。
- 設問ごとに安定 ID と版情報を持ち、古い外部ファイルによる上書きを検出できる。
- 解答結果の表示時に、疑義フラグまたは解説追加フラグを付けられる。解説追加フラグは既存解説があっても設定できる。

## Approach

keyword UUID を外部キーとする専用 question マスタを Supabase に追加し、owner RLS と keyword 所有関係を DB で保証する。設問の通常編集とフラグ状態を本仕様が所有し、学習履歴・SRS と AI 用ファイル交換は下流仕様へ分離する。更新日時または単調増加する version を外部交換時の楽観的競合検知に利用する。

## Scope

- **In**: keyword 1件対設問複数、設問 ID、並び順、有効状態、設問文、模範解答、選択肢、解説、疑義フラグ、解説追加フラグ、版管理、CRUD、owner 分離、1,000件超の取得
- **Out**: 設問の出題・採点・SRS、穴埋め履歴との合算、AI API 呼出し、外部ファイルの生成・取込、1設問の複数 keyword 紐付け

## Boundary Candidates

- 設問マスタと keyword への1:N関連
- 設問内容の検証、順序、版管理
- 通常編集 UI と結果画面から呼べるフラグ更新契約
- owner RLS、keyword 削除時の扱い、監査可能な更新時刻

## Out of Boundary

- 解答履歴や SRS 状態の永続化
- AI に渡す抽出条件やファイル schema
- AI が生成した内容の採点・品質保証
- keyword の記法、正答、本文出現契約の再定義

## Upstream / Downstream

- **Upstream**: `identity-and-access` の owner/RLS、`learning-content-catalog` の構造整合性とページング、`markdown-keyword-authoring` の keyword UUID・正答正規化、`app-shell-and-responsive-experience` の共通 UI
- **Downstream**: `structured-question-study`、`question-generation-exchange`

## Existing Spec Touchpoints

- **Extends**: なし。構造化設問は新しい責務境界として所有する
- **Adjacent**: `markdown-keyword-authoring` は keyword 本体を所有し、本仕様は参照するだけ。`adaptive-study-session` は穴埋め学習を所有し、本仕様の成績を持たない

## Constraints

- 全設問データは `owner_id` を持ち、keyword と同一 owner でなければならない
- 既存 migration は変更せず、新しい timestamp の migration を追加する
- ブラウザから service role を利用しない
- 1回1,000行の取得上限を超えても欠落させない
- version／更新日時は export 後の通常編集を stale import から保護できる精度を持つ
