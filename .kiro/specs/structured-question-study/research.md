# 調査・設計判断

## Summary
- **Feature**: `structured-question-study`
- **Discovery Scope**: Extension（既存の設問バンクと学習規則を利用する新規学習境界）
- **Key Findings**:
  - 設問マスタは`structured-question-bank`が安定ID・版・flag更新を所有し、本仕様は公開読取／更新契約だけを消費する。
  - 穴埋め学習の正答正規化・形式切替・SRS基礎規則は再利用できるが、履歴・統計テーブルとセッション状態は分離しなければならない。
  - 回答履歴追加と統計・SRS更新は単一RPCにし、期待設問版を検査することで古い表示への回答記録を防げる。
  - 横断レビューにより、代表位置を全本文出現の最小`(subjectOrder, materialOrder, chapterOrder, bodyOccurrenceIndex)`へ固定した。keyword統計はactive設問だけの合計・差分・比率・件数を唯一の式として公開し、statsなし／attempts 0を明示する。

## Research Log

### 既存学習境界の再利用
- **Context**: 「現在の穴埋めと同じ」解答方式を、成績を混ぜずに実現する。
- **Sources Consulted**: `adaptive-study-session/requirements.md`、`adaptive-study-session/design.md`、`markdown-keyword-authoring/design.md`
- **Findings**: 正答正規化、選択／記述／自動切替、SRS計算は純粋規則である。候補射影・履歴・統計・画面状態は穴埋め固有である。
- **Implications**: 純粋規則をconsumerとして利用し、question専用adapter、テーブル、API、画面を作る。別解登録は初期範囲外とする。

### 設問マスタとの整合
- **Context**: 学習中に通常編集・無効化・削除が起こり得る。
- **Sources Consulted**: `structured-question-bank/requirements.md`、`structured-question-bank/design.md`
- **Findings**: 設問は単調増加versionを持ち、下流は安定ID、version token、flag mutationを利用できる。
- **Implications**: セッション候補にversionを保持し、記録RPCはowner、有効状態、期待versionを同一transaction内で検査する。flag更新は設問バンクAPIへ委譲する。

### 階層候補と大量件数
- **Context**: 科目・教材・章・keyword範囲で1,000件超を欠落させない。
- **Sources Consulted**: `contracts.md`、`learning-content-catalog/design.md`、`structured-question-bank/design.md`
- **Findings**: 章所属は`keywords.chapter_id`ではなく章本文のdoc ID出現から求める。全件読取はcatalog所有のStablePagedReader、設問読取はbankの教材全件契約を使う。
- **Implications**: question IDで重複排除し、階層・keyword・questionの安定一意順序を維持する。1,001件のvolume回帰を設ける。

### 原子性と権限
- **Context**: 履歴とSRSの部分成功、別ownerアクセスを防止する。
- **Sources Consulted**: `tech.md`、`contracts.md`、`identity-and-access/design.md`
- **Findings**: 新規user-data RPCはinvoker、空search path、schema修飾、authenticated限定grantと4主体回帰が必要である。
- **Implications**: `20261011010000_create_structured_question_study.sql`で専用2テーブル、RLS、記録RPCを追加し、RpcSecurityMatrixへ列挙する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Decision |
|---|---|---|---|---|
| 専用履歴・統計 + 原子的RPC | question単位の成績を別テーブルで保持 | 分離が明確、集計しやすい | 新規schemaが必要 | 採用 |
| 既存keyword statsへ種別列追加 | 同じテーブルへ混在 | 表面上の追加が少ない | 誤集計・既存回帰の危険 | 不採用 |
| ブラウザ内だけで統計 | 永続化しない | DB変更不要 | SRS継続と交換抽出不可 | 不採用 |

## Design Decisions

### Decision: questionを専用成績aggregateとする
- `structured_question_stats`をquestionごとに1行、`structured_question_answer_logs`を不変の回答eventとして保持する。
- question削除時は専用成績もcascadeし、穴埋めテーブルへは一切書き込まない。

### Decision: 記録時に設問版を検査する
- セッション開始時のversionをRPCへ渡し、現在版・有効状態・ownerが一致した場合だけ履歴とstatsを更新する。
- 同じ回答の自動再送idempotency keyは追加せず、UIのsubmit guardと失敗後の明示再試行を採用する。

### Decision: 新規依存を追加しない
- React、Supabase、PostgreSQL、既存純粋規則で実現できる。外部SRS／採点ライブラリは不要である。

## Risks & Mitigations
- 穴埋め成績との混入 — 別テーブル、別API、負の回帰テストで防ぐ。
- 古い設問への記録 — expected versionとactive確認をRPC内で行う。
- 1,000件上限の候補欠落 — 上流のpaged contractと1,001件テストを使う。
- 記録途中失敗 — DB test transaction内の一時triggerによる段階別失敗注入でrollbackを確認する。

## References
- `.kiro/specs/structured-question-bank/design.md` — 設問読取、version、flag契約
- `.kiro/specs/adaptive-study-session/design.md` — 形式、判定、SRS基礎規則
- `.kiro/steering/contracts.md` — ページング、RPC、所有境界
