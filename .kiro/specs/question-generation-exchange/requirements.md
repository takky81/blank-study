# 要求仕様書

## プロジェクト説明

個人学習者は、疑義や解説不足を感じた既存設問と、成績に対して設問数が不足するキーワードを外部AIへまとめて渡したい。現在は対象を一貫して抽出する手段も、PC上で手動処理したAI成果を安全に戻す交換形式もない。本機能は、対象抽出、バージョン付きファイルの出力、検証と差分preview、原子的な取込を提供する。

## 境界コンテキスト

- **対象**: 固定論理式によるDB集計、抽出理由と文脈を含むUTF-8 JSON、download/upload、全件検証、preview、版競合、原子的import、処理済みフラグの選択的解除
- **対象外**: 外部AIへの通信、プロンプト送信、AI出力の品質判定、設問の通常CRUD、学習履歴・統計・SRSの更新、削除、部分取込、競合の自動上書き
- **隣接期待**: 設問バンクがID・版・フラグ、設問学習が専用統計、既存階層がkeywordと本文文脈を提供する。本機能はそれらを変更せず利用する。

## 要求

### Requirement 1: 生成・修正対象の条件指定
**目的:** 学習者として、見直し指示または苦手度と設問不足を満たす対象を抽出したい。それにより、AI作業を必要な対象へ集中できる。

#### 受入基準
1. The 設問交換機能 shall 疑義フラグ、解説追加フラグ、誤答回数、出題回数、正答率、キーワード別設問数を抽出判断に使用する
2. When 学習者が最低出題回数、最大正答率、最大設問数を指定する, the 設問交換機能 shall 各閾値を抽出条件として保持する
3. The 設問交換機能 shall `疑義フラグあり OR 解説追加フラグあり OR (誤答1回以上 AND 出題回数が最低値以上 AND 正答率が最大値以下 AND 設問数が最大値以下)` の固定式で対象を判定する
4. When 設問が疑義または解説追加フラグで対象になる, the 設問交換機能 shall 成績条件に関係なく当該設問を既存設問の修正または増補対象にする
5. When キーワードが統計条件だけで対象になる, the 設問交換機能 shall 当該キーワードを新規設問追加対象にする
6. If 閾値が未入力、範囲外、または数値でない, the 設問交換機能 shall 抽出を開始せず該当入力を示す
7. When キーワードの成績条件を評価する, the 設問交換機能 shall 有効な設問だけについて出題回数の合計、正解回数の合計、その差である誤答回数、合計正解回数÷合計出題回数の正答率、有効設問数を使用し、統計なしまたは出題回数0を統計条件不成立として扱う

### Requirement 2: 欠落しない対象集計
**目的:** 学習者として、データ量が増えても条件に合う対象を漏れなく得たい。それにより、AI用ファイルの信頼性を維持できる。

#### 受入基準
1. When 抽出を実行する, the 設問交換機能 shall 認証利用者が所有するキーワード、設問、設問専用統計だけを評価する
2. The 設問交換機能 shall 穴埋め学習の履歴、正答率、SRSを抽出統計へ合算しない
3. When 1,000件を超えるキーワード、設問、または学習統計が存在する, the 設問交換機能 shall 条件該当件を欠落・重複なく集計する
4. When 対象を返す, the 設問交換機能 shall 各対象についてフラグまたは各統計条件のどれに該当したかを示す
5. When 同じキーワードが複数の条件を満たす, the 設問交換機能 shall キーワードを重複させずすべての該当理由を保持する
6. If 対象集計に失敗する, the 設問交換機能 shall 不完全な結果を出力せず再試行可能なエラーを示す
7. When 同じキーワードの複数設問にフラグがある, the 設問交換機能 shall キーワードを1対象として返し、その配下に全フラグ設問と設問ごとの修正・解説追加依頼を保持する

### Requirement 3: 手動AI作業用ファイルの出力
**目的:** 学習者として、対象と必要な文脈を安定したファイルで外部AIへ手動で渡したい。それにより、アプリからAIへ接続せず設問を生成・修正できる。

#### 受入基準
1. When 対象が1件以上ある状態で出力する, the 設問交換機能 shall schema版を持つUTF-8 JSONファイルをdownloadする
2. The 設問交換機能 shall 対象keywordの安定ID、表示語、模範となる正答情報、科目・教材・章の階層、関連本文、抽出理由を出力する
3. When 既存設問がフラグ対象である, the 設問交換機能 shall 設問ID、export時の版、設問文、模範解答、選択肢、解説、疑義内容（任意、なければnull）、疑義の理由コード（`answer_guessable`（知識がなくても解ける（問題文や選択肢から推測できる））、`low_value`（問う価値が低い）、`defective`（問題不備（正解・問題文の誤り、正解が一つに決まらない））、`unclear`（問題文が分かりにくい）、定義順、なければ空配列）、対象フラグを出力する
4. When 新規設問追加対象である, the 設問交換機能 shall AI返却項目で設問IDを付与しない依頼として出力する
5. The 設問交換機能 shall 外部AIの種類、アカウント、API、送信処理をファイルへ埋め込まず、利用者のPC上での手動操作に委ねる
6. If 抽出結果が0件である, the 設問交換機能 shall 空ファイルをdownloadせず対象がないことを示す
7. While 出力を処理している, the 設問交換機能 shall 同じ出力操作の二重実行を受け付けない
8. The 設問交換機能 shall export JSONを`schemaVersion`、`exchangeId`、`exportedAt`、`filters`、`targets`を持つobjectとして扱い、各targetへkeyword表示情報、集計値、抽出理由、本文出現ごとの階層pathと章本文、既存設問、フラグ対象設問を含める
9. When export targetを整列する, the 設問交換機能 shall targetをkeyword ID、階層pathを科目順・教材順・章順・各ID、既存設問を設問順・設問ID、フラグ対象設問を設問IDの昇順で安定整列する
10. The 設問交換機能 shall 正答率と解説だけをnullableとし、出題回数0の正答率をnull、解説なしをnull、配列項目の該当なしを空配列として出力する
11. When `EligibilityTarget`をexportへ写像する, the 設問交換機能 shall `keywordId`、`metrics`、`reasons`、`flaggedQuestions`を同一keywordの`QuestionExchangeTargetV1`へ欠落なく写像し、各`ExportQuestion.requestedFlags`を同じquestionの`flaggedQuestions.requestKinds`と一致させる
12. When update operationを返却する, the 設問交換機能 shall exportした`ExportQuestion.requestedFlags`を`sourceRequestedFlags`へ順序も含めて変更せず複製させ、その部分集合だけを`resolvedFlags`として受け付ける

### Requirement 4: 返却ファイルの構文・参照検証
**目的:** 学習者として、AIから返された内容を保存前に完全に検証したい。それにより、不正データや他利用者データの混入を防げる。

#### 受入基準
1. When 学習者がJSONファイルを選択する, the 設問交換機能 shall 書込み前に文字コード、構文、schema版、必須項目、値の型を検証する
2. The 設問交換機能 shall 新規設問をIDなし、既存設問更新を設問IDとexport時版ありとして区別する
3. If 未知のkeyword ID、未知のquestion ID、keywordとquestionの不一致、またはowner不一致がある, the 設問交換機能 shall ファイル全体を保存不可にする
4. If 同じquestion IDがファイル内に複数回現れる, the 設問交換機能 shall 重複箇所を示してファイル全体を保存不可にする
5. If 設問文、模範解答、選択肢、解説が設問バンクの内容規則に違反する, the 設問交換機能 shall 項目位置と理由を示してファイル全体を保存不可にする
6. If ファイルに削除命令または未対応の操作がある, the 設問交換機能 shall ファイル全体を保存不可にする
7. If 1件でも検証エラーがある, the 設問交換機能 shall 有効な行だけを部分保存しない

### Requirement 5: Previewと版競合
**目的:** 学習者として、保存前に新規追加・既存更新・競合・エラーを確認したい。それにより、意図しない上書きを避けられる。

#### 受入基準
1. When 構文と参照の検証が完了する, the 設問交換機能 shall 新規、更新、競合、エラーの件数と各内容をpreviewする
2. When 既存設問の現在版がexport時版と一致する, the 設問交換機能 shall 変更前後を既存更新として表示する
3. If 既存設問の現在版がexport時版と異なる, the 設問交換機能 shall stale競合として現在内容と返却内容を表示する
4. If stale競合が1件でもある, the 設問交換機能 shall 自動上書きも取込実行も許可しない
5. When preview後に元設問が更新される, the 設問交換機能 shall 取込時にも版を再検査して古いpreviewによる上書きを防ぐ
6. When 学習者がpreviewを取り消す, the 設問交換機能 shall 設問とフラグを変更しない

### Requirement 6: 原子的な取込とフラグ解除
**目的:** 学習者として、確認した返却内容を一括で安全に反映したい。それにより、中途半端な設問更新を残さずに済む。

#### 受入基準
1. When 競合とエラーがないpreviewを学習者が確定する, the 設問交換機能 shall 新規設問追加と既存設問更新を1つの原子的操作として保存する
2. If 保存中のいずれかの項目、参照、owner、版、または永続化処理が失敗する, the 設問交換機能 shall 設問追加、更新、版更新、フラグ解除をすべて取り消す
3. When 既存設問の疑義に対応した更新が成功する, the 設問交換機能 shall その設問の疑義フラグだけを解除する
4. When 既存設問の解説追加依頼に対応した更新が成功する, the 設問交換機能 shall その設問の解説追加フラグだけを解除する
5. When 同じ設問で両フラグへの対応が成功する, the 設問交換機能 shall 両方を解除する
6. The 設問交換機能 shall ファイルに含まれないフラグと、返却内容が対応対象として示さないフラグを解除しない
7. When 取込が成功する, the 設問交換機能 shall 追加・更新・解除件数を表示し最新状態を再読込する
8. While 取込を処理している, the 設問交換機能 shall 同じ操作の二重送信を受け付けない

### Requirement 7: 所有者分離・安全性・操作性
**目的:** 学習者として、自分の交換データだけを安全かつ分かりやすく扱いたい。それにより、外部ファイルを介しても所有境界を保てる。

#### 受入基準
1. While 学習者が認証済みである, the 設問交換機能 shall その学習者が所有する対象だけを出力・preview・取込可能にする
2. If 未認証の利用者が集計または取込を要求する, the 設問交換機能 shall 実行を許可しない
3. If 他利用者のIDを含むファイルを認証利用者が取り込む, the 設問交換機能 shall 対象の存在または内容を漏らさず拒否する
4. The 設問交換機能 shall ブラウザ利用者に管理者権限を要求しない
5. When ファイル検証、集計、または取込に失敗する, the 設問交換機能 shall 操作文脈、修正可能な理由、再試行方法を示す
6. When 狭い画面で操作する, the 設問交換機能 shall 条件入力、ファイル選択、preview、確定操作へ横スクロールなしで到達可能にする
7. The 設問交換機能 shall 入力、エラー、preview区分、確定操作をキーボードと支援技術で識別可能にする
8. When 公開される集計または取込操作が変更される, the 設問交換機能 shall owner、cross-owner、未認証、管理用主体の権限境界を再検証可能にする
9. When 設問を一括取込する, the 設問交換機能 shall 設問バンクと同じ内容検証、版更新、フラグ規則を利用し、同じ業務変更を独自実装しない
10. When 一括取込RPCが設問バンクの非公開mutation primitiveへ委譲する, the 設問交換機能 shall `SECURITY INVOKER`のまま、API非公開`private` schemaに対する認証主体の最小DB内部権限を使って同一transaction内で処理する
11. The 設問交換機能 shall 非公開mutation primitiveをSupabase REST/RPCから直接公開せず、公開取込RPCとprimitiveの双方でowner、keyword、question、期待版、内容、flag不変条件を再検証する
12. The 設問交換機能 shall feature-local route adapterとして交換画面、認証要否、および共通導線metadataをapp-shellの登録契約へ提供し、`src/App.tsx`または共通navigationを直接変更しない
13. The 設問交換機能 shall route ID `questions.exchange`、path `/question-exchange`、navigation ID `nav.questions.exchange`、label `設問交換`、配置`wide`を提供し、任意の`subjectId`、`materialId`、`chapterId`、`keywordId` UUID検索parameterと許可済み相対`returnTo`を解釈する
14. If route検索parameterが不正、階層的に矛盾、または`returnTo`が許可外である, the 設問交換機能 shall 書込みや抽出を開始せず該当parameter errorを表示し、復帰先を`/questions`へ固定する
