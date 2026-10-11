# 実装計画

## Baseline Evidence

- 科目境界: `src/features/subjects/api.ts`, `validation.ts`, `validation.test.ts`, `SubjectsPage.tsx`
- 教材境界: `src/features/materials/api.ts`, `MaterialsPage.tsx`, `src/lib/summary.ts`
- 章境界: `src/features/chapters/api.ts`, `tree.ts`, `tree.test.ts`, `ChapterTree.tsx`。`src/features/editor/EditorPage.tsx` は consumer であり本仕様は所有しない。
- 永続化と連携: `supabase/migrations/20260829000000_init.sql`, `20260903000000_material_summary.sql`, `20260904000000_sync_active_keywords.sql`, `src/features/editor/api.ts`
- 回帰資産: `spec/tables/02-subject.jsonl` 14列、`03-material.jsonl` 15列、`04-chapter.jsonl` 16列、`e2e/subject.spec.ts`, `material.spec.ts`, `chapter.spec.ts`, `study.spec.ts`
- 実行確認: `src/features/subjects/validation.test.ts` と `src/features/chapters/tree.test.ts` は14件すべて成功（2026-10-10）。`npm run test:e2e -- e2e/subject.spec.ts e2e/material.spec.ts e2e/chapter.spec.ts` はローカル Supabase と Chromium で43件すべて成功（2026-10-10、1 worker）。
- E2E 前提: Node.js 24、`.env.local`、ローカル Supabase DB／Auth／REST、Playwright Chromium、`globalSetup` の利用者作成とデータ初期化、`workers: 1`、`fullyParallel: false`。
- 未検証ギャップ: 教材追加後の初期章 INSERT 失敗に対する補償 DELETE、移動元 sibling の再採番、構造一覧の1,000件超ページング、owner／material／parent の DB 整合性に直接回帰がない。

- [ ] 1. カタログの純粋ポリシーと永続化契約を固定する
- [x] 1.1 名前と一次元順序の共通ポリシーを実装・検証する
  - 前後空白の除去、空／空白だけの拒否、同名許容、範囲内外の並べ替えを副作用のない規則に閉じる。
  - 名前規則と並べ替えを扱う7件のユニットテストが成功する状態を完了条件とする。
  - _Boundary: NameAndOrderPolicy_
  - _Requirements: 1.1, 1.2, 1.3, 2.4, 3.6_

- [x] 1.2 (P) 章ツリーの構築と循環しない部分木移動を実装・検証する
  - 親子関係、兄弟順、深さ、子孫判定、循環拒否、同じ親での並べ替え、部分木移動を純粋ロジックに閉じる。
  - 章ツリーを扱う7件のユニットテストが成功する状態を完了条件とする。
  - _Boundary: ChapterTreeModel_
  - _Requirements: 4.1, 5.1, 5.2, 5.3, 5.4_

- [x] 1.3 (P) 階層・順序・削除参照整合性を永続化する
  - 科目、教材、章と関連するキーワード、学習状態、解答履歴について、外部キー、cascade／set null、非空名制約、順序 index を定義する。
  - 科目／教材の完全削除と、章削除時のキーワード／履歴保持を migration と E2E の DB 確認が示す状態を完了条件とする。
  - _Boundary: CatalogPersistence_
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 4.3, 6.4, 6.6, 6.9_

- [x] 1.4 大量件数に耐える教材集計を提供する
  - 章数、有効キーワード数、正答数／出題数、当日復習件数を教材単位で DB 集計し、アプリ型へ変換する。
  - 1000件を超えるキーワードでも、科目・教材一覧の件数が頭打ちにならない E2E 結果を完了条件とする。
  - _Boundary: CatalogSummaryGateway_
  - _Requirements: 2.1, 3.5, 7.1, 7.3_

- [ ] 1.5 owner／subject／material／parent 整合性をDBで強制する
  - `20261010000000_catalog_integrity.sql` で subject、material、chapter、nullable な keyword provenance に複合 FK または同等の constraint validation を追加する。
  - 既存データを事前検査してから制約を有効化し、通常 Data API と一括処理の双方へ同じ整合性規則を適用する。
  - migration 適用後に正当な同一owner／material関係だけを保存できる schema となることを完了条件とする。
  - _Boundary: CatalogPersistence_
  - _Depends: 1.3_
  - _Requirements: 6.11, 6.12, 6.13_

- [ ] 1.6 複合整合性と4主体の権限を統合回帰で固定する
  - 通常 Data API と代表 catalog RPC から、別ownerの親、別materialの親章、別materialのprovenanceを保存できないことを検証する。
  - identity 所有の RpcSecurityMatrix harness を利用し、owner成功、cross-owner分離、anon拒否、service roleの準備・事後確認限定を検証する。
  - catalog-integrity E2E が正当な書込と3種類の不正関連付けを区別し、全4主体の結果を観測できる状態を完了条件とする。
  - _Boundary: CatalogIntegrityConformance_
  - _Depends: 1.5; upstream identity-and-access task 6.7_
  - _Requirements: 6.11, 6.12, 6.13_

- [x] 2. 科目コレクションを接続する
- [x] 2.1 科目 API で一覧・変更・影響集計・削除を提供する
  - 保存順の一覧、末尾作成、名称変更、順序保存、教材単位集計の結合、削除影響の exact count、cascade 削除を提供する。
  - UI の再読込によって保存結果と全件の削除影響数を観測できる状態を完了条件とする。
  - _Boundary: SubjectCatalogApi_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2_

- [x] 2.2 科目一覧の作成・名称変更・空状態・失敗・削除確認を提供する
  - 二重送信防止、操作エラー、空状態、削除確認と取消、並べ替えの楽観表示と失敗時復元を画面状態で制御する。
  - 追加失敗時に一覧を保ち、削除前に影響件数と取消不能を確認できる状態を完了条件とする。
  - _Boundary: SubjectsPage_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.2, 6.3, 6.10_

- [x] 2.3 科目の決定表回帰を直列 E2E で固定する
  - 作成、名称変更、空状態、追加失敗、削除確認／取消／cascade、順序保存、1000件超集計を実利用者経路で検証する。
  - `subject.spec.ts` の14件がローカル Supabase 上で成功する状態を完了条件とする。
  - _Boundary: SubjectCatalogApi, SubjectsPage, CatalogPersistence, CatalogSummaryGateway_
  - _Depends: 1.1, 1.3, 1.4, 2.1, 2.2_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.2, 6.3, 6.4, 6.10, 7.1, 7.2_

- [x] 3. 教材コレクションと学習導線を接続する
- [x] 3.1 (P) 教材 API で順序付き CRUD、初期章、集計、影響削除を提供する
  - 表示中の科目への末尾追加、同名の最上位章、名称／順序変更、一覧集計、削除影響の exact count、cascade 削除を提供する。
  - 通常作成で教材と初期章が揃い、操作後の再読込で各指標と順序を観測できる状態を完了条件とする。
  - _Boundary: MaterialCatalogApi_
  - _Depends: 1.1, 1.3, 1.4_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.11, 6.5, 6.6, 6.7, 7.3, 7.4_

- [x] 3.2 教材一覧の表示指標、空状態、学習開始可否を提供する
  - 章数、有効キーワード数、正答率、当日復習件数を表示し、空状態では科目全体の学習導線を表示しない。
  - キーワード0件では科目／教材の学習開始を無効にし、1件以上では双方の導線が有効になる状態を完了条件とする。
  - _Boundary: MaterialsPage_
  - _Requirements: 3.5, 3.7, 3.8, 3.9_

- [x] 3.3 教材一覧と API の名称変更・順序・削除・not-found を統合する
  - 名称変更、楽観的な順序変更、削除影響確認、削除失敗時の一覧維持、科目 not-found、科目間移動なしを接続する。
  - 再表示で順序が残り、削除確認／失敗／not-found で所定の画面状態になることを完了条件とする。
  - _Boundary: MaterialsPage, MaterialCatalogApi_
  - _Requirements: 3.4, 3.6, 3.10, 3.11, 6.5, 6.6, 6.7, 6.10_

- [x] 3.4 教材の決定表回帰を直列 E2E で固定する
  - ローカル Supabase、`.env.local`、signed-in fixture、管理用クライアント、Chromium、1 worker を実行前提にする。
  - `material.spec.ts` の15件が成功し、通常作成、一覧指標、学習導線、削除、順序、大量件数を DB 副作用込みで検証する状態を完了条件とする。
  - _Boundary: MaterialCatalogApi, MaterialsPage, CatalogPersistence, CatalogSummaryGateway_
  - _Depends: 1.1, 1.3, 1.4, 3.1, 3.2, 3.3_
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 6.5, 6.6, 6.7, 6.10, 7.3, 7.4_

- [ ] 4. 教材内の章ツリーを接続する
- [x] 4.1 (P) 章 API で配置・一覧・作成・名称変更・影響集計を提供する
  - 教材の配置情報、保存順の章一覧、選択章の子／最上位への末尾追加、名称変更、自身と子孫の影響集計を提供する。
  - 操作成功後の再読込で `parentId`、タイトル、`sortOrder`、影響件数を観測できる状態を完了条件とする。
  - _Boundary: ChapterCatalogApi_
  - _Depends: 1.1, 1.2, 1.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 6.8_

- [x] 4.2 章ツリーの空状態・not-found・再試行と移動禁止を提供する
  - ARIA tree、空状態の追加案内、教材 not-found、読込失敗後の再試行、教材間移動なしを editor 画面へ統合する。
  - not-found ではツリーを表示せず、再試行成功後は既存章が表示される状態を完了条件とする。
  - _Boundary: ChapterTreeIntegration_
  - _Requirements: 4.1, 4.5, 4.6, 4.7, 4.8_

- [x] 4.3 章の並べ替えとネスト変更を画面へ接続する
  - 章／隙間への drop、循環拒否、楽観的ツリー、変更行保存、失敗時復元を統合する。
  - 再読込後も親子関係と兄弟順が残り、失敗時は操作前のツリーへ戻る状態を完了条件とする。
  - _Boundary: ChapterTreeModel, ChapterCatalogApi, ChapterTreeIntegration_
  - _Depends: 1.2, 4.1, 4.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 4.4 章削除 preview と下流同期用 result を提供する
  - 対象章と子孫章の ID／body を返す preview と、削除後の対象教材 ID／削除章 ID を返す result を chapter API に閉じる。
  - 自身と子孫だけを削除し、keyword／解答履歴を保持して provenance `chapter_id` を null 化する。
  - catalog から authoring 実装を import／直接呼出しせず、DB確認で章0件、keyword／履歴残存、resultの教材ID／削除章IDが観測できる状態を完了条件とする。
  - _Boundary: ChapterCatalogApi, ChapterDeletionSignal, CatalogPersistence_
  - _Depends: 1.3, 4.1_
  - _Requirements: 6.8, 6.9_

- [x] 4.5 章管理と下流順序の回帰を直列 E2E で固定する
  - ローカル Supabase、`.env.local`、signed-in fixture、管理用クライアント、Chromium、1 worker を実行前提にする。
  - 既存 `chapter.spec.ts` と `study.spec.ts` の章順ケースが、CRUD、部分木移動、既存の削除／履歴保持、新しい出現順を検証する状態を完了条件とする。新しいpreview／result契約は4.4で追加検証する。
  - _Boundary: ChapterCatalogApi, ChapterTreeIntegration, CatalogPersistence_
  - _Depends: 1.2, 1.3, 4.1, 4.2, 4.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 4.6 親をまたぐ章移動で両 sibling set を再採番する
  - 純粋な移動計画で移動元と移動先の兄弟を安定順に並べ、双方を0から欠番なく再採番する。
  - 変更された移動元・移動先の全行を保存し、再読込後にも同じ親子関係と順序を再現する。
  - 同親移動、別親移動、最上位との往復を unit／E2E で検証し、下流の出現順にも新順序が渡る状態を完了条件とする。
  - _Boundary: ChapterTreeModel, ChapterCatalogApi, ChapterTreeIntegration_
  - _Depends: 1.2, 4.1, 4.3_
  - _Requirements: 5.1, 5.2, 5.4, 5.6, 5.7_

- [ ] 5. 全件ページングとDB参照整合性を完成させる
- [ ] 5.1 共通ページング契約を安定した一意順序へ固定する
  - 1,000件単位の range、実返却件数による前進、既知 total／0件／total不明時の終了条件を純粋 helper に閉じる。
  - 同順位でも `id` を最終 tie-breaker とする呼出規則を明記し、短い応答、2,500件、同順位、重複 ID の unit 回帰を追加する。
  - page 上限が想定より小さい場合も欠落・重複せず全件が安定順で返る状態を完了条件とする。
  - _Boundary: StablePagedReader_
  - _Requirements: 7.5, 7.6, 7.7, 7.8_

- [ ] 5.2 科目・教材一覧を共通ページングへ接続する
  - 科目一覧と科目内教材一覧を、保存順と一意 ID の複合順序で共通 helper へ接続する。
  - 集計は既存の DB 集約を維持し、一覧行だけを全件取得して指標と結合する。
  - 1,001件超の科目／教材が欠落・重複なく保存済み順に返る API 統合結果を完了条件とする。
  - _Boundary: SubjectCatalogApi, MaterialCatalogApi, StablePagedReader_
  - _Depends: 5.1_
  - _Requirements: 2.1, 3.5, 7.5, 7.6_

- [ ] 5.3 章・本文・keyword の全件取得契約を共通ページングへ接続する
  - 教材内章と章本文を親、兄弟順、一意 ID の安定順序で取り切る catalog API を提供する。
  - keyword 全件を必要とする下流 feature には table-neutral な `fetchAll` 公開契約だけを提供し、filter／query／mapping／業務ロジックは各下流 adapter に委ねる。
  - 1,001件超の章／本文が欠落・重複なく返り、keyword query も同じ helper で構成可能な型契約となる状態を完了条件とする。
  - _Boundary: ChapterCatalogApi, StablePagedReader_
  - _Depends: 5.1_
  - _Requirements: 4.1, 7.7, 7.8_

- [ ] 5.4 科目・教材の全件取得を直列E2Eで固定する
  - 1,001件超の科目と、同一科目に1,001件超の教材を別ケースで管理用クライアントから準備する。
  - 科目一覧と教材一覧で件数、先頭／末尾、保存順、一意性を確認する。
  - 再読込と複数 page の境界をまたいでも科目／教材の同じ全件集合になる E2E 結果を完了条件とする。
  - _Boundary: StablePagedReader, CatalogVolumeConformance_
  - _Depends: 5.2_
  - _Requirements: 7.5, 7.6_

- [ ] 5.5 章・本文の全件取得を直列E2Eで固定する
  - 同一教材に1,001件超の章／本文を管理用クライアントから準備する。
  - 章ツリーと章本文APIで件数、先頭／末尾、親子・兄弟順、一意性を確認する。
  - 再読込と複数 page の境界をまたいでも章／本文の同じ全件集合になる E2E 結果を完了条件とする。
  - _Boundary: StablePagedReader, CatalogVolumeConformance_
  - _Depends: 5.3_
  - _Requirements: 7.7_

- [ ] 5.6 table-neutral な全件取得を keyword 行で適合検証する
  - 1,001件超の raw keyword 行を準備し、下流 feature の filter／mapping を持ち込まず `fetchAll` callback だけで全件取得する。
  - `(material_id, doc_id, id)` の安定順序、件数、先頭／末尾、一意性を helper の統合回帰として確認する。
  - catalog が keyword adapter を所有せず、共通ページング契約だけで欠落・重複のない全行を取得できる状態を完了条件とする。
  - _Boundary: StablePagedReader, CatalogVolumeConformance_
  - _Depends: 5.1_
  - _Requirements: 7.8_

- [ ] 6. 教材作成補償を統合回帰で固定する
  - ローカル Supabase と直列 Playwright を起動し、signed-in fixture と管理用クライアントで作成前後の DB を確認する。
  - 章の POST だけを失敗させ、教材 POST 成功後の補償 DELETE を通す。
  - 画面に失敗が表示され、DB 確認で教材も章も0件のままになる E2E 結果を完了条件とする。
  - _Boundary: MaterialCatalogApi, MaterialsPage, CatalogPersistence_
  - _Depends: 1.3, 3.1, 3.4_
  - _Requirements: 3.3_
