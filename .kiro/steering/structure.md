# プロジェクト構造

## 組織方針

feature-first + shared utility を採用する。画面、業務フロー、データアクセス、機能固有ロジックは同じ feature にまとめ、複数 feature で安定して共有する UI と純粋ロジックだけを共通領域へ置く。

## ディレクトリパターン

### Feature

**場所**: `src/features/<domain>/`  
**目的**: 業務領域ごとの画面、API、純粋ロジック、機能固有コンポーネント  
**パターン**:

- `<Domain>Page.tsx`: ルート画面、状態、利用者操作のオーケストレーション
- `api.ts`: Supabase 呼び出し、DB 行とアプリ型の変換
- 小文字の役割名 `.ts`: 検証、パース、計算、順序付けなどの純粋ロジック
- 純粋ロジックのテストは同じディレクトリに `<module>.test.ts`

### 共通 UI

**場所**: `src/components/`  
**目的**: 複数画面で再利用する表示・レイアウト部品  
**制約**: 原則として自ら業務データを取得せず、props と context で受け取る。

### 共通基盤と純粋ロジック

**場所**: `src/lib/`  
**目的**: feature 横断の値変換、Markdown／キーワード処理、テーマ、ページング、Supabase client など  
**基準**: 1 feature だけで使うものは、その feature に留める。複数 feature が同じ契約で使う段階で共通化する。

### 永続化

**場所**: `supabase/migrations/`  
**目的**: スキーマ、制約、index、RLS、RPC、権限  
**規則**: `YYYYMMDDHHMMSS_description.sql` を追加し、適用済み migration を書き換えない。

### 検証資産

- `e2e/`: Playwright の利用者経路と DB 統合テスト
- `spec/tables/`: 移行前仕様の詳細ケースとテスト対応を保持する回帰決定表
- `.kiro/specs/`: 今後の要求、技術設計、実装タスクの正式な機能仕様
- `design/`: 見た目の参照となるワイヤーフレーム

## 依存方向

基本形は次のとおり。

```text
App / Page
  -> feature component / pure logic / api.ts
      -> shared component / src/lib / Supabase
          -> PostgreSQL schema and RPC
```

- 同じ feature 内は相対 import、別ディレクトリは `@/` alias を使う
- barrel file は作らず、責務を持つ具体的なファイルから named export を import する
- feature 間参照は既存契約を再利用するときに許容するが、循環依存を新設しない
- 共通 UI が feature 型へ依存する既存箇所は拡大しない。新しい共通契約は `components` または `lib` 側で定義する
- DB への直接アクセスを Page や共通 UI へ追加せず、feature API 境界を通す

## 命名規約

- **ディレクトリ**: 小文字の業務名。集合資源は複数形、機能概念は単数形
- **React コンポーネント**: `PascalCase.tsx`、export 名も PascalCase
- **ページ**: `<Domain>Page.tsx`
- **非 UI モジュール**: 小文字または camelCase の役割名
- **関数・変数**: camelCase
- **型**: PascalCase。既存コードに合わせ `type` を基本とする
- **定数**: UPPER_SNAKE_CASE
- **React hook**: `use...`
- **DB／SQL**: snake_case
- **テスト**: `<module>.test.ts`、E2E は `<domain>.spec.ts`
- **export**: named export を基本とし、default export は設定などフレームワーク要求箇所に限る

## Import 例

```typescript
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import type { KeywordRow } from './api';
import { normalizeDraft } from './validation';
```

外部パッケージ、`@/` 絶対 import、同一 feature の相対 import の順を基本とする。型 import を明示する。

## 変更単位

- 新機能は、所有する責務が明確な既存 spec を拡張するか、新しい境界の spec を先に作る
- 1 つの変更で、承認済み spec、必要な決定表、コード、テストの対応を保つ
- 複数 spec を横断する変更は、依存する上流契約を先に更新し、下流を再検証する
- 生成物 (`dist/`, `spec/dist/`, `test-results/`) をソース構造として扱わない

---
_新しいコードが既存パターンに従う限り、この文書を更新しなくてよい粒度を保つ。_
