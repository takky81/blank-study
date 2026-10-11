import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011000003_add_structured_question_reorder.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question reorder migration contract', () => {
  it('defines one invoker RPC with an empty search path and no grants', () => {
    const sql = migrationSql();

    expect(sql).toContain('public.reorder_structured_questions(');
    expect(sql).toContain('p_keyword_id uuid');
    expect(sql).toContain('p_ordered jsonb');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
    expect(sql).not.toMatch(/(?:grant|revoke) .* function public\.reorder_structured_questions/);
  });

  it('locks the whole keyword set and validates ids, uniqueness, and versions before updating', () => {
    const sql = migrationSql();

    expect(sql).toContain('from public.structured_questions');
    expect(sql).toContain('for update');
    expect(sql).toContain('jsonb_array_elements');
    expect(sql).toContain('count(distinct');
    expect(sql).toContain('version-conflict');
    expect(sql).toContain('ordinal - 1');
    expect(sql).toContain('update public.structured_questions');
  });

  it('serializes creates and reorders through one keyword-set lock protocol', () => {
    const sql = migrationSql();

    expect(sql).toContain('private.lock_structured_question_keyword_set()');
    expect(sql).toContain('before insert on public.structured_questions');
    expect(sql).toContain('where id = new.keyword_id and owner_id = new.owner_id');
    expect(sql.match(/for update/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
