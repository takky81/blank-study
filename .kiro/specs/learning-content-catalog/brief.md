# Brief: learning-content-catalog

## Problem

個人学習者が教材を科目、教材、章の階層で整理し、順序や構造を保ちながら安全に管理できる必要がある。

## Current State

科目・教材の CRUD と並べ替え、教材作成時の初期章、章のネスト・移動・削除、影響件数確認、大量件数集計が実装済み。決定表 `02-subject.jsonl`、`03-material.jsonl`、`04-chapter.jsonl` と対応する E2E が検証する。

## Desired Outcome

教材階層のデータ所有、並び、削除連鎖、章削除時の履歴保持を、編集・転送・学習が依存する安定契約にする。

## Approach

科目→教材→自己参照章ツリーを一つの catalog boundary として扱い、本文とキーワード内容は authoring spec に委ねる。

## Scope

- **In**: 名前検証、作成、変更、同名許容、末尾追加、並べ替え、章のネスト／移動制約、空状態、再試行、削除影響、cascade、章削除時のキーワード非活性化、大量件数の欠落防止、教材一覧の学習導線可否
- **Out**: Markdown 本文編集、キーワード内容、zip の解析、出題アルゴリズム

## Boundary Candidates

- 科目・教材の ordered collection
- 教材内の chapter tree
- 削除と参照整合性

## Out of Boundary

- 科目間の教材移動、教材間の章移動

## Upstream / Downstream

- **Upstream**: identity-and-access、app-shell-and-responsive-experience
- **Downstream**: markdown-keyword-authoring、material-portability、adaptive-study-session、learning-insights

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: authoring が章本文と keyword master を所有する

## Constraints

章階層は Markdown 見出しではなく DB の `parent_id` で表す。科目・教材削除は履歴を含め cascade し、章削除は履歴を保持する。
