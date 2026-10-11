# 実装計画

## Baseline Evidence

- transfer 実装: `src/features/transfer/archive.ts`, `zip.ts`, `match.ts`, `api.ts`, `download.ts`, `ImportControl.tsx`。現行 `match.ts` は authoring 所有の共有契約へ抽出予定。
- upstream／shared 契約: authoring 所有の `src/lib/body.ts`, `keyword.ts`, `answer.ts`, 計画中の `keywordMatch.ts`、catalog 所有の `paged.ts`、app-shell 所有の `src/components/ConflictDialog.tsx` と `submitGuard.ts`
- UI 接続: `src/features/materials/MaterialsPage.tsx`, `src/features/editor/EditorPage.tsx`
- 永続化: `supabase/migrations/20260829000000_init.sql`, `20260830000000_import_material.sql`, `20260831000000_grants.sql`, `20260901000000_revoke_rpc_from_anon.sql`, `20260902000000_harden_functions.sql`
- 回帰資産: `spec/tables/10-import.jsonl` 19列、`spec/tables/11-export.jsonl` 10列、`src/features/transfer/archive.test.ts`, `zip.test.ts`, `match.test.ts`, `e2e/transfer.spec.ts`
- fresh evidence（2026-10-10）: transfer ユニット3ファイル29件、transfer E2E 11件、TypeScript 型検査、決定表対象29/29列・全体289/289列、production build が成功。build は既存の chunk-size 警告のみ。
- E2E 前提: Node.js 24、`.env.local`、Docker、local Supabase DB／Auth／REST、Playwright Chromium、signed-in fixture、admin verification client、`workers: 1`、`fullyParallel: false`。
- 未完了ギャップ: export の章取得が単一要求で1,000件超を欠落し得る。`import_material` は subject／material／parent の所有関係を検証しない。現行 E2E の failure は RPC 到達前の通信 abort であり、関数内部の途中失敗 rollback を直接検証しない。

- [x] 1. zip と章ツリーの純粋変換契約を固定する
- [x] 1.1 (P) zip bytes の encode／decode と安全な出力名を実装・検証する
  - UTF-8 の path-content map を zip bytes へ変換して読み戻し、壊れた bytes は利用者向けエラーへ変換する。
  - 教材名の使用不能文字を置換し、空になった名前には既定名を与える。
  - `archive.test.ts` の3件が成功し、round trip、corrupt archive、zip filename を観測できる状態を完了条件とする。
  - **見積り: 1時間**
  - _Boundary: ArchiveCodec_
  - _Requirements: 1.1, 1.5, 3.10_

- [x] 1.2 章ツリーを順序付き Markdown path へ変換する
  - 子を持つ章をフォルダと `index.md`、葉章を `.md` とし、兄弟順を連番プレフィックスへ反映する。
  - 同名章を連番で区別し、ファイル名の使用不能文字だけを置換し、余分なメタ情報、履歴、画像を含めない。
  - nested tree、同名章、unsafe title、空章、keyword なしを含む unit assertions が成功し、全章の path-content map が得られる状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: ZipTreeCodec_
  - _Depends: 1.1_
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.3_

- [x] 1.3 zip の Markdown path から章ツリーを復元する
  - 連番を兄弟順へ戻してタイトルから除き、連番なしは名前順、`index.md` は親章本文、index なし folder は空本文として扱う。
  - `.md` 以外を章にせず、Markdown が0件なら永続化前に拒否する。
  - nested folder と export-import tree round trip を unit assertions で観測できる状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: ZipTreeCodec_
  - _Depends: 1.1_
  - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 2. キーワードと transfer gateway のベースラインを固定する
- [x] 2.1 export する本文と全キーワードを接続する
  - 教材の全キーワードを共通 paging で取得し、章内の最初の出現だけをフル形式、以降を ID-only として Markdown を生成する。
  - 本文にない非活性キーワードを追加せず、キーワード0件でも本文を出力し、取得失敗を操作文脈付きエラーへ変換する。
  - 1001キーワードの E2E で最後の ID まで展開され、ID-only の未展開記述が残らない状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: TransferGateway, TransferPagingAdapter, AuthoringContracts_
  - _Depends: 1.2_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

- [x] 2.2 import plan で章を平坦化し ID と本文を正規化する
  - 教材 import と選択章配下 import を排他的 target とし、親先行の temporary chapter ID を持つ plan を書込みなしで作る。
  - 規約内の imported ID は保持して突合へ渡し、ID が欠落／規約外の場合だけ既存教材と同じ import 内で先に採番した ID を避けて規約内 ID を割り当てる。
  - keyword fields と最初の定義章を provenance hint として保持し、章 membership は各本文の doc ID 出現に残したうえで本文を ID-only へ縮約する。
  - `prepareImport` 完了時点では DB が変わらず、`ImportPlan` が chapters、apply、conflicts、chapter mapping を持つ状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: TransferGateway, AuthoringContracts_
  - _Depends: 1.3_
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 2.3 (P) import keyword の現行突合結果を characterization する
  - unknown ID を新規、正規化後に正答が重なる既存 ID を履歴継続の overwrite、正答不一致を conflict とする。
  - zip 内の同一 ID／異内容を conflict、同一内容を1件の apply とし、確認対象を自動適用へ混ぜない。
  - `match.test.ts` の8件が成功し、new、overwrite、answer conflict、duplicate conflict、zero conflict を観測できる状態を完了条件とする。
  - **見積り: 2時間**
  - 現行 `match.ts` の判定結果に対する証拠であり、共有契約の所有移行と adapter 化は5.1で行う。
  - conflict の全候補列挙と candidate ID による一意な解決は現行証拠に含めず、5.1の未完了ギャップとする。
  - _Boundary: KeywordMatchCharacterization_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 3. transfer UI と原子的 import の現行接続を固定する
- [x] 3.1 教材／章 import と conflict resolution を画面へ接続する
  - 科目画面では zip stem の新規教材、editor では選択章配下を target とし、同名教材でも既存教材へ統合しない。
  - conflict が0件なら即時確定し、存在時は ID、登録済み正答、incoming 正答を表示して既定を既存維持にする。
  - overwrite／keep／cancel、処理中 disabled、成功後の一覧再読込、失敗 alert が UI と DB の双方で観測できる状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: ImportControl, ConflictDialogAdapter, MaterialUiIntegration, EditorUiIntegration_
  - _Depends: 2.2, 2.3_
  - _Requirements: 3.1, 3.2, 3.3, 3.9, 3.10, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.7_

- [x] 3.2 教材 export と browser download を画面へ接続する
  - 教材行の操作から export artifact を作り、sanitized material name の zip として browser download を開始する。
  - 章0件または取得失敗では download を完了せず shared alert に理由を表示する。
  - Playwright download から zip を読み戻し、期待する path と展開本文を確認できる状態を完了条件とする。
  - **見積り: 1時間**
  - _Boundary: MaterialUiIntegration, TransferGateway, BrowserDownload_
  - _Depends: 1.1, 1.2, 2.1_
  - _Requirements: 1.1, 1.5, 1.6, 2.6_

- [x] 3.3 現行 import RPC の transaction、権限、search path を証拠化する
  - 認証利用者 ID を insert／upsert 行へ設定し、教材、親先行の章、確定 keyword を1回の関数呼出しで処理する現行契約を固定する。
  - `(material_id, doc_id)` の upsert で既存 row identity と履歴参照を継続し、material import は subject の末尾 order を使う。
  - invoker 権限、空 search path、schema qualification、authenticated／service-role execute、anon／public revoke が migration から確認できる状態を完了条件とする。target ownership と identity 実行回帰は5.3だけが変更責務を持つ。
  - **見積り: 3時間**
  - _Boundary: ImportRPC, KeywordPersistence_
  - _Depends: 2.2, 2.3_
  - _Requirements: 5.3, 7.1, 7.2, 7.4, 7.5_

- [x] 4. 現行ベースラインの characterization evidence を固定する
- [x] 4.1 transfer の純粋ロジック回帰を実行する
  - archive、zip tree、keyword match の3ファイルを同じ Vitest 実行へ含める。
  - 29件が成功し、決定表10／11の純粋変換と判断規則を検証する状態を完了条件とする。
  - これは変更後の最終 gate ではなく、未変更 baseline に対する証拠として保持する。
  - **見積り: 1時間**
  - _Boundary: ArchiveCodec, ZipTreeCodec, KeywordMatchCharacterization_
  - _Depends: 1.1, 1.2, 1.3, 2.3_
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 2.1, 2.2, 2.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7_

- [x] 4.2 transfer の現行利用者経路と DB 副作用を直列 E2E で実行する
  - local Supabase、signed-in fixture、admin verification client、Chromium、1 worker を実行前提にする。
  - 11件が成功し、material／chapter import、overwrite／keep、input errors、export、round trip、1001 keywords を観測できる状態を完了条件とする。
  - 通信 abort の失敗ケースは現行 UI の no-change evidence に限定し、RPC 内部 rollback の証明は6.3が所有する。
  - **見積り: 2時間**
  - _Boundary: MaterialUiIntegration, EditorUiIntegration, ImportControl, ConflictDialogAdapter, TransferGateway, ImportRPC_
  - _Depends: 3.1, 3.2, 3.3_
  - _Requirements: 1.1, 2.1, 2.4, 3.1, 3.3, 3.10, 4.1, 4.3, 4.4, 5.2, 5.3, 5.4, 5.7, 6.1, 6.2, 6.3, 6.4, 7.2, 7.5, 7.6, 7.7_

- [ ] 5. 共有契約移行、大量章 export、import target ownership のギャップを閉じる
- [ ] 5.1 authoring 所有の共有キーワード突合契約を portability adapter から利用する
  - authoring が `src/lib/answer.ts` と `src/lib/keywordMatch.ts` に所有する `AnswerNormalization`、`KeywordMatchPlanner`、`Plan`、`Conflict`、overlap／duplicate 契約を import plan から直接利用する。
  - portability 側は imported chapter から共有 planner 入力を作る薄い `match.ts` adapter と統合テストだけを持ち、同ファイルの共有型と判定を削除する。`api.ts` の既存 import path は変えない。
  - 妥当な imported ID がそのまま same-ID overwrite／conflict／identical duplicate の判定へ届き、既存 keyword UUID と履歴を継続できる状態を完了条件とする。
  - 同じ doc ID が複数の imported chapter body に残り、keyword payload の章 ID は最初の定義章を示す provenance hint に限られることを adapter 統合テストで確認する。
  - 既存行なし／ありの異内容 duplicate では共有 conflict の全候補を app-shell dialog へ渡し、選択した candidate ID だけを payload に含め、未解決・未知候補を永続化前に拒否する。
  - 外部 prerequisite は `markdown-keyword-authoring` Tasks 5.1, 5.2 と `app-shell-and-responsive-experience` Task 3.9 の完了であり、portability 側では共有型や判定を再定義しない。
  - _Boundary: KeywordMatchAdapter_
  - _Depends: 2.2, 2.3; upstream `markdown-keyword-authoring` tasks 5.1, 5.2 and `app-shell-and-responsive-experience` task 3.9_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 7.5, 7.6_

- [ ] 5.2 (P) export の章を全ページ取得する
  - 共通 paging を通して `sort_order` に従うすべての章を取得し、1回の取得上限を超える章も `buildFiles` へ渡す。
  - 2ページ目以降の取得が失敗した場合も教材 export の操作文脈を持つエラーとして伝播し、browser download を発生させない。
  - catalog 所有の `src/lib/paged.ts` 自体は変更せず TransferPagingAdapter に適用し、既存の keyword paging、zip path、export UI contract を変えず任意ページ数の章を欠落なく artifact に含められる状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: TransferGateway, TransferPagingAdapter_
  - _Depends: 2.1_
  - _Requirements: 2.5, 2.6_

- [ ] 5.3 (P) import RPC で target ownership、親子関係、実行 identity を検証する
  - `20261010020000_harden_import_targets.sql` で既存 `import_material` signature を置換し、subject、material、parent chapter が認証利用者の所有範囲かを書込み前に検証する。
  - parent が指定 material に属することも検証し、同じ利用者の別教材 chapter を親にする要求を拒否する。
  - 既存 client payload、関数返却値、`SECURITY INVOKER`、空 search path、schema qualification、grants を維持し、適用済み migration を変更しない。
  - authenticated owner の成功、cross-owner の読取／更新拒否、anon の実行拒否を検証し、service role は seed／後検証など E2E の準備・管理だけに限定され通常 import 呼出しに使われない状態を完了条件とする。
  - **見積り: 2〜3時間**
  - _Boundary: ImportRPC_
  - _Depends: 3.3; upstream `learning-content-catalog` tasks 1.5, 1.6 and `identity-and-access` task 6.7_
  - _Requirements: 7.3_

- [ ] 6. 未完了ギャップを直列 E2E と最終品質 gate で閉じる
- [ ] 6.1 1,001章の export と途中ページ失敗を E2E で検証する
  - 1,001章を複数階層と確定順で seed し、download zip の全 path 数、末尾章、代表的な兄弟順が欠落しないことを確認する。
  - 2ページ目の chapter read だけを失敗させ、文脈付き alert が表示され download event が発生しないことを確認する。
  - 取得上限を超えても全章を含み、途中失敗では不完全な zip を利用者へ渡さない状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: TransferGateway, MaterialUiIntegration, TransferE2E_
  - _Depends: 5.2_
  - _Requirements: 2.5, 2.6_

- [ ] 6.2 foreign target と別教材 parent の拒否を E2E で検証する
  - 別利用者の subject、material、parent chapter をそれぞれ authenticated client から指定し、各呼出しが拒否されることを確認する。
  - 同じ利用者が所有する別教材の chapter を parent にした場合も拒否されることを確認する。
  - 各失敗の前後で materials、chapters、keywords の変更が0件である状態を admin verification client から観測する。
  - **見積り: 2時間**
  - _Boundary: ImportRPC, TransferE2E_
  - _Depends: 5.3_
  - _Requirements: 7.3_

- [ ] 6.3 RPC 内部失敗の rollback を E2E で検証する
  - service role ではなく認証利用者コンテキストから実 RPC を呼び、valid chapter の処理後に規約外 `doc_id` の DB constraint で確実に失敗する payload を用意する。
  - 呼出し前後で materials、chapters、keywords の行と内容がすべて不変であり、途中作成章も残らないことを admin verification client で確認する。
  - RPC 到達前の通信 abort ではなく、transaction 内部例外でも全変更が rollback される状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: ImportRPC, TransferE2E_
  - _Depends: 5.3_
  - _Requirements: 7.2_

- [ ] 6.4 変更後の全品質 gate と隣接契約を再検証する
  - Node.js 24、`.env.local`、Docker、local Supabase、Playwright Chromium、1 worker を準備し、新 migration を反映した DB を使う。
  - 型検査、全ユニット、決定表カバレッジ、production build、全 E2E を実行し、transfer 対象29/29列と全体289/289列の参照を維持する。
  - transfer E2E により authoring の記法／正規化／共有 planner を使う portability adapter、catalog paging adapter、app-shell の dialog／submit guard 統合、identity の owner isolation を再検証し、すべて成功する状態を完了条件とする。study は設計の再検証トリガーに従う study 側 task で判定する。
  - **見積り: 2時間**
  - _Boundary: MaterialPortabilityIntegrationValidation_
  - _Depends: 6.1, 6.2, 6.3_
  - _Requirements: 2.5, 2.6, 7.2, 7.3, 7.6_
