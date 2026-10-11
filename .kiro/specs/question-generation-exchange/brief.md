# Brief: question-generation-exchange

## Problem

個人学習者は、設問が不足している keyword や、解答中に疑義・解説不足を感じた設問をまとめて外部 AI へ渡し、PC 上の手動操作で新規設問や修正版を作らせたい。現在は対象抽出、AIへ渡す安定したファイル契約、安全な差分確認と取り込みがない。

## Current State

教材 zip の持ち運びは `material-portability` が所有するが、構造化設問の生成依頼や修正依頼を表すファイルではない。ブラウザから AI API を呼ぶ基盤はなく、プロダクト方針でも専用サーバーを持たない。設問成績とフラグは新しい上流仕様で管理される。

## Desired Outcome

- 次の式で対象 keyword／question を抽出できる。

```text
疑義フラグあり
OR 解説追加フラグあり
OR (
  誤答が1回以上
  AND 出題回数が指定値以上
  AND 正答率が指定値以下
  AND keyword に紐づく設問数が指定値以下
)
```

- フラグ対象は既存設問の修正・増補、統計対象は主に新規設問追加として依頼種別を分ける。
- keyword、階層、関連本文、既存設問、対象理由、設問 ID、version を手動 AI 作業用ファイルへ出力できる。
- AIから返されたファイルを検証し、新規追加と既存更新を preview して原子的に取り込める。
- export 後に通常編集された設問を古いファイルで自動上書きしない。

## Approach

バージョン付き UTF-8 JSON の exchange schema を定義し、ブラウザ標準 File API で保存・読込する。抽出条件は PostgreSQL の view／RPC で集計して1,000行上限と性能問題を避ける。import は全件を先に parse・schema検証・owner検証・version照合し、新規／更新／競合／エラーを preview する。競合または不正が1件でもあれば書き込まず、確認済みの有効ファイルだけを単一 RPC で原子的に保存する。

## Scope

- **In**: 条件値入力、OR/AND固定式、DB側集計、抽出理由、関連文脈、versioned JSON export、File API download/upload、schema検証、重複・未知参照・stale version検知、新規／更新 preview、原子的 import、成功した対象フラグの解除、1,000件超
- **Out**: AI API呼出し、プロンプト送信の自動化、AI出力品質の自動判定、意味類似採点、importによる削除、競合の自動上書き、教材zip形式の変更

## Boundary Candidates

- 設問生成対象の DB 集計と抽出理由
- AI作業用 exchange schema と schema version
- export adapter とブラウザ download
- import parser、参照・版・業務検証
- preview と原子的 import RPC
- 成功した修正／増補フラグだけを解除する結果契約

## Out of Boundary

- question マスタの通常編集
- question stats／logs と SRS 更新
- 外部 AI の選択、アカウント、プロンプト画面、料金管理
- 失敗・競合ファイルの部分取り込み
- AIファイルからの設問削除

## Upstream / Downstream

- **Upstream**: `structured-question-bank` の question ID／version／フラグ、`structured-question-study` の専用成績、`learning-content-catalog` の階層・ページング、`markdown-keyword-authoring` の keyword と本文文脈、`identity-and-access` の RLS／RPC、`material-portability` の安全なファイル処理パターン
- **Downstream**: 将来の AI API 自動化またはバッチ生成機能は同じ exchange schema を消費できる

## Existing Spec Touchpoints

- **Extends**: なし。教材の持ち運びではなく、設問生成・修正依頼の交換契約を新しく所有する
- **Adjacent**: `material-portability` の zip import/exportを変更しない。`learning-insights` の画面集計を変更しない

## Constraints

- AI操作はPC上で利用者が手動で行い、アプリは外部AIへ通信しない
- 新規設問は question ID なし、既存更新は question ID と export 時 version を必須とする
- 未知 keyword/question、重複ID、不正な選択肢、stale version、owner不一致が1件でもあれば全件保存しない
- import前に新規・更新・競合・エラーの件数と内容を表示する
- 削除命令を schema に含めない
- 抽出と保存はDB側集計／RPCを使い、1回1,000行上限で欠落しない
