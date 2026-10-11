import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = join(process.cwd(), 'supabase/migrations/20261011020001_import_question_exchange.sql');

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/--[^\r\n]*/g, '').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('import_question_exchange migrationの契約', () => {
  it('owner入力を受け取らずpayloadだけを引数に取りauth.uid()で判断する', () => {
    const sql = migrationSql();
    expect(sql).toContain('create or replace function public.import_question_exchange( p_payload jsonb )');
    expect(sql).not.toMatch(/p_owner/);
    expect(sql).toContain('auth.uid()');
  });

  it('全operationの検証loopが完了してからだけbank primitiveへ委譲する', () => {
    const sql = migrationSql();
    const delegation = sql.indexOf('private.apply_structured_question_content(');
    expect(delegation).toBeGreaterThan(0);
    for (const check of ['duplicate question id', 'version conflict', 'resolved flags', 'keyword not found', 'question not found']) {
      const at = sql.indexOf(check);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(delegation);
    }
  });

  it('exchange内に設問の直接insert/updateを持たず業務mutationを重複させない', () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/insert into public\.structured_questions/);
    expect(sql).not.toMatch(/update public\.structured_questions/);
  });

  it('SECURITY INVOKER・空search pathでauthenticatedだけにEXECUTEを許可する', () => {
    const sql = migrationSql();
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
    expect(sql).not.toContain('security definer');
    expect(sql).toContain('revoke all on function public.import_question_exchange(jsonb) from public, anon');
    expect(sql).toContain('grant execute on function public.import_question_exchange(jsonb) to authenticated');
  });
});
