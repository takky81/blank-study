import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011000002_add_structured_question_mutation.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question mutation migration contract', () => {
  it('defines the private invoker primitive with an empty search path', () => {
    const sql = migrationSql();

    expect(sql).toContain('create schema if not exists private');
    expect(sql).toContain(
      'private.apply_structured_question_content( p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb )',
    );
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('update public.structured_questions');
    expect(sql).toContain('where id = p_question_id and version = p_expected_version');
  });

  it('exposes one command RPC and delegates every mutation command to the primitive', () => {
    const sql = migrationSql();

    expect(sql).toContain('public.mutate_structured_question(');
    for (const command of ['create', 'update-content', 'set-flags', 'set-active', 'delete']) {
      expect(sql).toContain(`'${command}'`);
    }
    // The exact name appears only in the primitive definition and public delegation.
    expect(sql.match(/private\.apply_structured_question_content\(/g)).toHaveLength(2);
    expect(sql).not.toMatch(/create (or replace )?function public\.set_structured_question_(flags|active)/);
    expect(sql).toContain("if p_command = 'create' and p_question_id is not null");
    expect(sql).toContain("if p_command <> 'create' and p_keyword_id is not null");
    expect(sql).toMatch(/if p_command <> 'update-content'.*p_content is not null/);
    expect(sql).toMatch(/if p_command <> 'set-flags'.*p_flag_patch is not null/);
  });

  it('leaves schema and function grants to the QuestionPersistence security task', () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/(?:grant|revoke) .* schema private/);
    expect(sql).not.toMatch(/(?:grant|revoke) .* function (?:private|public)\./);
  });
});
