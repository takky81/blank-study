# 調査と設計判断

## Summary

- **Feature**: `learning-insights`
- **Discovery Scope**: Extension（既存実装のベースライン化）
- **Key Findings**:
  - `history` feature は、所有者スコープの永続データ取得、純粋集計、表示状態を分離している。科目・教材・章の管理と解答記録は上流境界に残る。
  - 達成度は active keyword だけを対象とし、未出題／苦手／定着、正答率、今日／今週、順位、14日間の日別量を副作用なく算出する。定着しきい値は `study/question.ts` の `SETTLED_COUNT = 3` と `SETTLED_RATE = 0.9` を参照する。
  - `keywords.chapter_id` は provenance hint であり章所属ではない。各 `chapters.body` の doc ID 出現を章では出現単位、教材／科目では keyword UUID 単位で集計する必要があるが、現行実装と回帰はこの契約を満たしていない。
  - キーワード1,002件の統合回帰はあるが、構造行と解答履歴の1,001件超、所有者混在、API失敗後の再試行、複数章出現、provenance 章削除後の別章再投影には直接回帰がない。

## Research Log

### 学習履歴 read model と上流カタログ契約

- **Context**: 履歴画面が教材階層のどの意味を利用し、どこからを所有しないかを固定する必要があった。
- **Sources Consulted**: `src/features/history/api.ts`、`src/features/history/HistoryPage.tsx`、`learning-content-catalog` と `markdown-keyword-authoring` の requirements／design、`.kiro/steering/contracts.md`、`supabase/migrations/20260829000000_init.sql`
- **Findings**:
  - `loadHistory` は科目、教材、章を保存順で取得し、`parent_id` を再帰的に辿って `HistoryNode` を構成する。
  - 現行の章ノードは `keywords.chapter_id` から `keywordIds` を構成するため、同じ doc ID の同一章内複数出現、複数章出現、provenance 章削除後の別章残存を表現できない。
  - authoring 契約では doc ID token が本文内 identity であり、`chapter_id` は初回作成元の provenance に限る。章所属は各 `chapters.body` の token 出現から再構成する。
  - 章と祖先は token 出現を重複込みで持つ一方、教材／科目は同じ keyword UUID を重複除外する。本文に出ない active keyword は教材／科目にだけ含める。
  - `subjects`、`materials`、`chapters` の ID、名称、順序、親子／owner 整合性、安定ページングは catalog が所有する。履歴画面は read model を作るだけで変更しない。
- **Implications**: 本仕様は本文出現を `AggregationRef` へ投影する adapter だけを所有する。keyword parser、provenance／活性同期、catalog CRUD、DB 制約、`src/lib/paged.ts` は変更しない。

### 達成度、復習予定、および順位の純粋集計

- **Context**: 決定表 `19-history.jsonl` の列1〜14、19と実装の対応を確認した。
- **Sources Consulted**: `src/features/history/aggregate.ts`、`aggregate.test.ts`、`src/features/study/question.ts`、`spec/tables/19-history.jsonl`
- **Findings**:
  - `classify` は0回を未出題、3回以上かつ90%以上を定着、それ以外の出題済みを苦手にする。境界値を含み、値は study の自動形式判定と共用する。
  - `aggregate` は非活性を除外し、keyword 件数を総問題数、累積正答数÷累積出題数を正答率にする。出題0回では正答率を返さない。
  - 期限なしは未出題として今日／今週に含め、端末時刻の当日末と、日曜始まりの週の土曜末を境界にする。
  - `weakKeywords` は分類が weak のものだけではなく、active かつ出題済みの全 keyword を正答率昇順、同率なら出題回数降順にする。画面が先頭10件を表示し、settled の分類ラベルも表示し得る。
  - 別解登録後は上流が訂正した `keyword_stats.correct_count` と `answer_logs.is_correct` をそのまま読むため、履歴側に独自の補正規則はない。
- **Implications**: 集計関数は現行契約を維持し、定着値や別解訂正を複製して所有しない。上流の値・更新意味が変わる場合は本仕様を再検証する。

### 日別量と表示状態

- **Context**: 決定表の列15〜18と画面実装を確認した。
- **Sources Consulted**: `aggregate.ts`、`aggregate.test.ts`、`HistoryPage.tsx`、`e2e/history.spec.ts`、`19-history.jsonl`
- **Findings**:
  - `dailyVolume` は端末日付で指定日数の bucket を先に作り、範囲内の履歴を数える。履歴0件の日も保持し、古い日から並べる。画面の期間は14日固定である。
  - 履歴全体が0件なら chart を出さず、空状態を表示する。履歴が範囲外にだけ存在する場合は14個の0件 bucket を表示する。
  - 科目は初期展開し、教材以下は利用者操作で開く。子のない行は開閉できない。
  - 読込失敗は `role="alert"` と再試行操作を表示するが、失敗注入を伴う直接テストはない。
- **Implications**: UI の表示期間、空状態、階層展開、エラー回復を `HistoryPage` の状態契約として固定する。グラフライブラリや新しい分析画面は導入しない。

### 永続化、所有者境界、および大量件数

- **Context**: 1回1,000行上限と所有者分離を満たす取得経路を確認した。
- **Sources Consulted**: `src/features/history/api.ts`、`src/lib/paged.ts`、`src/lib/summary.ts`、`20260829000000_init.sql`、`20260903000000_material_summary.sql`、`20260904000000_sync_active_keywords.sql`、`e2e/history.spec.ts`
- **Findings**:
  - keywords と answer_logs は一意な `id` 順で共通 `fetchAll` を使う。E2E は既存1件と追加1,001件の合計1,002 keywords が現行の章と全体集計へ出ることを確認する。
  - subjects、materials、chapters／body は現行で全件ページングされず、構造または本文が1,000件を超えると欠落し得る。catalog 所有の StablePagedReader を全5 read に適用する必要がある。
  - answer_logs も同じページング経路だが、1,001件超を履歴画面で直接確認する fixture はない。
  - 全対象表は `owner_id` を持ち、authenticated role の RLS `USING`／`WITH CHECK` が `auth.uid()` へ制限する。signed-in の通常経路は通るが、所有者Aの履歴画面から所有者Bを排除する直接 fixture はない。
  - catalog の `material_summary` RPC は教材一覧用の active keyword・累積・当日期限集計を DB で欠落なく返す。history はこれを利用せず、全階層・順位・日別量に必要な行をページングする。RPC の ownership は catalog に残す。
  - `sync_active_keywords` は履歴を削除せず `is_active` だけを同期する。history の達成度と順位は非活性を除き、answer_logs に基づく日別量は残す。
- **Implications**: 大量件数の一般化は catalog 所有の `fetchAll` を消費し、新しい helper や summary RPC を重複定義しない。構造／本文、answer_logs 大量件数と所有者混在を未検証ギャップとして残す。

### テスト資産と直接証拠

- **Context**: brownfield の完了タスクと未検証タスクを区別した。
- **Sources Consulted**: `aggregate.test.ts`、`e2e/history.spec.ts`、`spec/tables/19-history.jsonl`
- **Findings**:
  - unit 19件は分類、非活性、空／未出題、重み付き正答率、今日／今週、上位合計、別解後累積、順位、日別bucketを直接検証する。
  - E2E 6件は現行の provenance ベース章集計、階層開閉、順位、当日量、履歴なし、1,002 keyword を直接検証する。本文出現契約の証拠にはならない。
  - `19-history.jsonl` は20列すべてに unit または E2E の参照を持つが、参照は個別 failure、owner isolation、answer_logs 1,001件を意味しない。
- **Implications**: `tasks.md` は上記直接証拠だけ `[x]` とし、本文出現 projection、複数章／重複出現、provenance 削除、構造／log 高容量、失敗注入、owner isolation を `[ ]` にする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 現行 feature-first + read model + 純粋集計 | API が所有者スコープを読み、純粋関数が集計し、Page が表示状態を持つ | 実装、unit、E2E、steering と一致する | API read model の細部に直接 unit が少ない | ベースラインとして採用 |
| `material_summary` の拡張 | すべての insight を DB 集計へ寄せる | 転送量を減らせる可能性がある | 階層、順位、日別量を catalog RPC に吸収し ownership が重なる | 不採用 |
| 決定表の列ごとの component 分割 | 各列を独立した境界にする | 列追跡は単純 | 同じ rows と表示状態を細分化し過ぎる | 不採用 |

## Design Decisions

### Decision: insight を読取り専用の下流投影に保つ

- **Context**: catalog と study が永続データの意味と更新を既に所有する。
- **Alternatives Considered**:
  1. history が keyword stats とログの更新も所有する
  2. history は上流データを読み取って投影するだけにする
- **Selected Approach**: 2。`HistoryData` は画面 read model であり、永続化 aggregate ではない。
- **Rationale**: 重複更新規則を避け、別解や SRS の変更点を上流へ一元化できる。
- **Trade-offs**: 上流 schema と分類値の変更時は history の再検証が必要になる。
- **Follow-up**: Revalidation Triggers に catalog tree、activity、stats／logs、settled constants を明記する。

### Decision: 分類インターフェースだけを一般化し、実装範囲を増やさない

- **Context**: 階層帯とキーワード順位の双方が同じ分類を表示する。
- **Selected Approach**: `StatRow -> Level` を単一分類契約とし、階層集計と一覧が再利用する。
- **Rationale**: 3区分の意味を1か所へ保ち、study 定数を参照できる。
- **Trade-offs**: 将来分類が増える場合は Summary、色、凡例、要件を同時に更新する必要がある。
- **Follow-up**: 仮説上の分類や目標機能は追加しない。

### Decision: catalog 所有の安定ページングを全 read で消費し、新規集計基盤を作らない

- **Context**: history は全構造／本文、keyword、log を必要とし、catalog RPC だけでは要求を満たさない。
- **Selected Approach**: catalog 所有の StablePagedReader を subjects、materials、chapters／body、keywords／stats、logs の全 read で消費する。
- **Rationale**: 1,000行上限を既存共通契約で越えられ、DB ownership を増やさない。
- **Trade-offs**: データ量に比例してブラウザへの転送量が増える。
- **Follow-up**: 構造を含む1,001件超回帰を追加する。性能問題が実測された場合に限り、history 所有の read RPC を別仕様で検討する。

### Decision: 章所属を本文出現から投影し集計単位を階層ごとに分ける

- **Context**: provenance と所属を同一視すると複数章出現と provenance 章削除後の残存を表現できない。
- **Selected Approach**: authoring の token 契約を消費して章本文から出現参照を作り、章／祖先は出現を保持し、教材／科目は keyword UUID で重複除外する。
- **Rationale**: 文書に見える出現を章集計へ正確に反映しながら、教材／科目の問題数を同一 keyword の重複で膨らませない。
- **Trade-offs**: 本文 token の走査と出現参照の保持が必要になる。
- **Follow-up**: 同一章重複、複数章、本文なし active keyword、provenance 章削除を unit／E2E へ追加する。

## Risks & Mitigations

- 解答履歴の2ページ目が欠落しても現行 E2E では検出できない — 1 keyword に当日 answer_logs 1,001件を batch seed し、日別件数と正答率を確認する。
- `chapter_id` 依存により同一 doc ID の複数出現または別章残存が漏れ得る — 本文 token の同一章2回／別章1回と provenance 章削除後の再投影を確認する。
- 構造／本文の2ページ目が欠落し得る — 科目、教材、章／本文を1,001件超 seed し、境界末尾の node と token を確認する。
- owner RLS の回帰が history 集計に現れない可能性がある — 所有者A／Bの同名階層と異なる件数を seed し、A画面にBが混入しないことを確認する。
- 一部 query failure の recovery が未検証である — answer_logs 初回取得だけをHTTP 500にし、alert と再試行成功を確認する。
- 上流の settled constants または別解訂正契約が変わると分類がずれる — adaptive-study-session の変更時に classification unit と history E2E を再実行する。

## References

- `.kiro/steering/product.md` — 階層別達成度、苦手、日別量と対象外
- `.kiro/steering/tech.md` — 型安全、所有者RLS、ページ上限、品質ゲート
- `.kiro/steering/structure.md` — feature-first、API境界、依存方向
- `.kiro/specs/learning-content-catalog/requirements.md`／`design.md` — 教材階層、active keyword、`material_summary` の上流契約
- `.kiro/specs/markdown-keyword-authoring/requirements.md`／`design.md` — doc ID token、provenance、残存本文による活性同期
- `.kiro/specs/identity-and-access/design.md` — owner RLS と共有 security fixture の上流契約
- `.kiro/steering/contracts.md` — StablePagedReader、provenance、共有 ownership
- `.kiro/specs/adaptive-study-session/requirements.md`／`design.md` — `keyword_stats`、`answer_logs`、別解訂正、3回／90%の上流契約
- `spec/tables/19-history.jsonl` — 既存20列の回帰詳細
