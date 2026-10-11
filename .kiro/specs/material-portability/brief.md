# Brief: material-portability

## Problem

個人学習者が教材をサービス外へ持ち出し、別の教材や章へ安全に取り込める必要がある。

## Current State

章階層を zip 内のフォルダ／Markdown ファイルへ変換する export、教材・章単位 import、ID 採番、既存 keyword 突合、衝突解決、RPC による原子的取り込みが実装済み。決定表 `10-import.jsonl`、`11-export.jsonl` と transfer tests が検証する。

## Desired Outcome

zip 形式、照合規則、エラー時の原子性を安定した外部データ契約として明文化する。

## Approach

ファイル解析と突合を純粋ロジック、永続化を単一 RPC transaction とする現在の境界を維持する。

## Scope

- **In**: zip 名、連番、フォルダ／`index.md` 構造、安全なファイル名、展開形式 export、教材新規／章配下 import、壊れた zip／Markdown なしの検出、ID 採番、正答重複／不一致の突合、利用者選択、全成功・全失敗、1000件超 export
- **Out**: 学習履歴・画像・内部 DB ID の export、クラウド同期、他形式

## Boundary Candidates

- zip と chapter tree の変換契約
- imported keyword と既存 keyword の照合
- import transaction

## Out of Boundary

- 教材間の直接移動、部分成功、学習状態の移植

## Upstream / Downstream

- **Upstream**: learning-content-catalog、markdown-keyword-authoring
- **Downstream**: 取り込み後の編集と学習

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: authoring の記法、ID、衝突解決契約

## Constraints

export/import の往復で教材内容と章順を保持する。途中失敗時は教材・章・keyword を一切部分反映しない。
