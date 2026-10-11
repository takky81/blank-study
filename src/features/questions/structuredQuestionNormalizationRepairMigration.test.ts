import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011000005_align_structured_question_normalization.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question normalization repair migration contract', () => {
  it('replaces only the primitive and preserves its locking/security shape', () => {
    const sql = migrationSql();

    expect(sql).toContain('create or replace function private.apply_structured_question_content(');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('for update');
    expect(sql).not.toContain('create or replace function public.mutate_structured_question');
  });

  it('does not fold full-width yen into backslash', () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/［￥］/);
    expect(sql).toContain('［＼］＾＿｀');
  });

  it('reasserts the exact ACL without broadening access', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'revoke all on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) from public, anon, service_role',
    );
    expect(sql).toContain(
      'grant execute on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) to authenticated',
    );
    expect(sql).not.toMatch(/grant execute .* to (?:public|anon|service_role)/);
  });
});
