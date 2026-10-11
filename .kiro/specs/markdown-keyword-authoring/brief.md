# Brief: markdown-keyword-authoring

## Problem

個人学習者が Markdown の文脈を保ったまま語句を問題化し、重複や衝突で学習履歴を壊さずに教材を編集できる必要がある。

## Current State

3ペイン編集、狭幅タブ、Markdown プレビュー、キーワード記法、6桁 ID 採番、保存形式／展開形式、keyword master、衝突確認、活性同期、未保存警告が実装済み。決定表 `05`〜`09` と editor E2E／ユニットテストが検証する。

## Desired Outcome

Markdown と keyword master の双方向契約、編集 UI、保存トランザクションを一貫した cc-sdd 仕様にする。

## Approach

本文内の記法を編集用の展開形式と永続化用の ID 参照形式に分け、`keywords` を意味情報の正とする現在の設計を固定する。

## Scope

- **In**: Markdown 表示、キーワード構文と CSV 相当エスケープ、選択からの作成、編集・解除、ID 検証／採番、保存時の縮約と再展開、keyword master 更新、正答衝突の解決、未使用 keyword の非活性化、未保存離脱、二重送信防止、1000件超の同期
- **Out**: 章そのものの CRUD、zip ファイル構造、出題と採点、画像描画

## Boundary Candidates

- キーワード記法 parser/formatter
- 章本文と keyword master の保存契約
- 編集画面の状態と衝突解決

## Out of Boundary

- 曖昧採点、共同編集、画像管理

## Upstream / Downstream

- **Upstream**: learning-content-catalog
- **Downstream**: material-portability、adaptive-study-session

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: material-portability は同じ記法と衝突解決の契約を利用する

## Constraints

文書内 ID は小文字英数字6桁で教材内一意。章内の最初の出現だけを展開し、保存時はすべて ID のみにする。画像記法は保持するが描画しない。
