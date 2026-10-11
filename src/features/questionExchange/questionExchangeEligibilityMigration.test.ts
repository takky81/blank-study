import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011020000_create_question_generation_exchange.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/--[^\r\n]*/g, '').replaceAll(/\s+/g, ' ').toLowerCase();
}

const SIGNATURE =
  'public.get_question_exchange_candidates(numeric, numeric, numeric)';

describe('question exchange eligibility migrationの契約', () => {
  it('owner入力を受け取らず3つの閾値だけを引数に取る', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'create or replace function public.get_question_exchange_candidates( p_minimum_attempts numeric, p_maximum_accuracy numeric, p_maximum_question_count numeric )',
    );
    expect(sql).not.toMatch(/p_owner/);
  });

  it('auth.uid()を起点に設問と設問専用統計だけを集計し穴埋め履歴を参照しない', () => {
    const sql = migrationSql();
    expect(sql).toContain('(select auth.uid())');
    expect(sql).toContain('from public.structured_questions');
    expect(sql).toContain('public.structured_question_stats');
    expect(sql).toContain('q.is_active');
    expect(sql).not.toMatch(/keyword_stats|answer_logs|answer_history/);
  });

  it('固定式の統計branchを誤答1以上・下限・上限・設問数のANDで評価する', () => {
    const sql = migrationSql();
    expect(sql).toContain('k.attempts > 0');
    expect(sql).toContain('k.attempts - k.correct >= 1');
    expect(sql).toContain('k.attempts >= p_minimum_attempts');
    expect(sql).toContain('<= p_maximum_accuracy');
    expect(sql).toContain('k.question_count <= p_maximum_question_count');
    expect(sql).toContain('order by k.keyword_id');
  });

  it('SECURITY INVOKER・空search pathでauthenticatedだけにEXECUTEを許可する', () => {
    const sql = migrationSql();
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
    expect(sql).not.toContain('security definer');
    expect(sql).toContain(`revoke all on function ${SIGNATURE} from public, anon, service_role`);
    expect(sql).toContain(`grant execute on function ${SIGNATURE} to authenticated`);
  });
});
