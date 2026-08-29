/**
 * 決定表の列がテストで押さえられているかを数える。
 *
 * 各表に対応するテストファイルを決めておき、その中に「列N」の記述が
 * あるかどうかで判定する。テスト名の付け方（「列3 …」）を頼りにした
 * 粗い確認だが、抜けた列に気づくには足りる。
 *
 *   node --experimental-strip-types spec/coverage.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TABLES_DIR = join(ROOT, 'spec', 'tables');

/** 表ごとに、その列を確かめているテストファイル。 */
const SOURCES: Record<string, string[]> = {
  認証: ['e2e/auth.spec.ts', 'src/features/auth/validation.test.ts'],
  科目の管理: ['e2e/subject.spec.ts', 'src/features/subjects/validation.test.ts'],
  教材の管理: ['e2e/material.spec.ts'],
  章の管理: ['e2e/chapter.spec.ts', 'src/features/chapters/tree.test.ts', 'e2e/study.spec.ts'],
  編集画面の操作: ['e2e/editor.spec.ts', 'src/lib/body.test.ts', 'src/lib/markdown.test.ts'],
  キーワード記法のパース: ['src/lib/keyword.test.ts'],
  キーワードIDの採番: ['src/lib/body.test.ts', 'e2e/editor.spec.ts'],
  保存と正規化: ['e2e/editor.spec.ts', 'src/lib/body.test.ts'],
  保存時の上書き確認: ['src/features/editor/overwrite.test.ts', 'e2e/editor.spec.ts'],
  インポートの単位: ['e2e/transfer.spec.ts', 'src/features/transfer/zip.test.ts'],
  インポート時のキーワード突合: [
    'e2e/transfer.spec.ts',
    'src/features/transfer/match.test.ts',
    'src/features/transfer/archive.test.ts',
  ],
  エクスポート: ['e2e/transfer.spec.ts', 'src/features/transfer/zip.test.ts'],
  出題順: ['src/features/study/order.test.ts', 'e2e/study.spec.ts'],
  解答形式の決定: ['src/features/study/question.test.ts', 'e2e/study.spec.ts'],
  選択肢の生成: ['src/features/study/question.test.ts', 'e2e/study.spec.ts'],
  表示範囲内のキーワードの表示: ['src/features/study/range.test.ts', 'e2e/study.spec.ts'],
  正誤判定: ['src/lib/answer.test.ts', 'e2e/study.spec.ts'],
  別解の登録: ['src/features/study/alt.test.ts', 'e2e/study.spec.ts'],
  'SRS の更新': ['src/features/study/srs.test.ts', 'e2e/study.spec.ts'],
  学習履歴の集計: ['src/features/history/aggregate.test.ts', 'e2e/history.spec.ts'],
  表示設定と共通の振る舞い: [
    'e2e/ui.spec.ts',
    'src/lib/theme.test.ts',
    'src/lib/submitGuard.test.ts',
    'src/lib/contrast.test.ts',
  ],
};

type Column = { table: string; col: number };

const columns: Column[] = [];
for (const file of readdirSync(TABLES_DIR).filter((f) => f.endsWith('.jsonl'))) {
  for (const line of readFileSync(join(TABLES_DIR, file), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as Column;
    columns.push({ table: row.table, col: row.col });
  }
}

const cache = new Map<string, string>();
function textOf(path: string): string {
  const found = cache.get(path);
  if (found !== undefined) return found;
  let content = '';
  try {
    content = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    content = '';
  }
  cache.set(path, content);
  return content;
}

const missing: Column[] = [];
for (const column of columns) {
  const sources = SOURCES[column.table] ?? [];
  // 「列3」の直後に別の数字が続くものは別の列なので外す
  const pattern = new RegExp(`列${column.col}(?![0-9])`);
  const covered = sources.some((path) => pattern.test(textOf(path)));
  if (!covered) missing.push(column);
}

const byTable = new Map<string, number>();
for (const column of columns) byTable.set(column.table, (byTable.get(column.table) ?? 0) + 1);

for (const [table, total] of byTable) {
  const lack = missing.filter((m) => m.table === table);
  const mark = lack.length === 0 ? 'OK ' : 'NG ';
  const detail = lack.length === 0 ? '' : ` 未カバー: ${lack.map((m) => `列${m.col}`).join(' ')}`;
  console.log(`${mark}${table} ${total - lack.length}/${total}${detail}`);
}

console.log(`\n合計 ${columns.length - missing.length}/${columns.length} 列`);
if (missing.length > 0) process.exitCode = 1;
