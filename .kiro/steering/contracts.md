# 共有契約と所有境界

複数の機能仕様が同じ型、値、DB 制約、共通ファイルを利用するときの所有者を定める。下流 spec は契約を利用し、同じ規則を再定義しない。

## キーワード契約

`markdown-keyword-authoring` が次を所有する。

- キーワード記法の parse / format と文書内 ID の規則
- 正答文字列の正規化と完全一致の基礎契約
- imported / edited keyword と既存 keyword の照合規則
- `Plan`、`Conflict`、正答 overlap、duplicate 判定の共有型と純粋ロジック
- `Conflict` は安定した conflict ID と、登録済み候補（存在する場合）および重複を除いた全 incoming 候補を保持する。解決結果は boolean ではなく候補 ID を指定し、同一入力内の同一 doc ID に異内容が複数あっても必ず1候補へ確定できる

共有実装は `src/lib/` に置き、editor、transfer、study はその契約を利用する。feature 間で型や照合ロジックを相互 import しない。変更時は authoring、portability、study を再検証する。

妥当な文書内 ID は import 時も保持する。ID が欠落・規約外で採番する場合だけ、対象教材の既存 ID と衝突しない値を割り当てる。妥当な既存 ID が対象教材に存在するときは、照合して同一 keyword 行を更新できるため、学習履歴を継続できる。

## 章出現と keyword の関係

`keywords.chapter_id` は最後に定義を取り込んだ章を示す provenance hint であり、唯一の所属章を表さない。出題と章別集計の所属は `chapters.body` に現れる doc ID から求める。

- 章別集計は本文中の出現単位で扱う
- 教材・科目集計では keyword UUID を重複排除する
- 同じ doc ID が複数章に現れてよい
- provenance 章を削除しても、別章本文に残る keyword は再同期で活性を保てる

この契約の変更時は authoring、study、insights、catalog の削除挙動を再検証する。

## 構造とページング

`learning-content-catalog` が、科目・教材・章の構造整合性と共通ページング契約を所有する。

- `src/lib/paged.ts` は安定した一意順序で 1,000 件ずつ取得し、必要な全行を取り切る
- 科目、教材、章、章本文の全件が必要な処理は、この契約または同等の DB 内集計／RPC を使う
- 下流 spec はページング実装を所有せず、feature adapter と統合テストだけを所有する
- 親をまたぐ章移動では、移動元と移動先の両 sibling set を安定順で 0 から再採番する

章の親子関係は同一 owner・同一 material に限る。subjects、materials、chapters の参照整合性はアプリの暗黙前提にせず、catalog 所有の DB 制約または同等の DB 検証で守る。

## 共通 UI と非同期ガード

`app-shell-and-responsive-experience` が共通 dialog、行操作、表示状態の横断契約、`src/lib/submitGuard.ts` を所有する。各 feature はそれを利用し、業務固有の状態遷移と統合テストだけを所有する。

共有 component を変更するタスクは所有 spec に置く。下流 spec の `_Boundary:` は feature adapter または統合箇所へ限定する。

## 認証・RPC

`identity-and-access` が RLS、role grant、owner policy の共通方針と列挙型の権限回帰テストを所有する。新しい user-data RPC を追加する spec は、その migration と業務契約を所有し、次を完了条件に含める。

- authenticated owner は実行できる
- cross-owner は他人のデータを読取・更新できない
- anon は実行できない
- service role はテスト準備・管理用途に限定する

公開 RPC の一覧が変わったら identity の権限回帰テストを再検証する。

## Migration の順序

同じタイムスタンプを再利用しない。今回のベースラインで計画する migration は次の順序を予約する。

1. `20261010000000_catalog_integrity.sql`
2. `20261010010000_save_chapter_with_keywords.sql`
3. `20261010020000_harden_import_targets.sql`
4. `20261010030000_record_study_answer.sql`
5. `20261010040000_register_study_alternative.sql`

新しい migration はこの後ろへ一意な時刻で追加する。上流の制約を先に導入し、下流 RPC と read model を再検証する。

---
_共有 seam の所有者と再検証条件を記録し、個別の受入基準やファイル一覧は各 spec に委ねる。_
