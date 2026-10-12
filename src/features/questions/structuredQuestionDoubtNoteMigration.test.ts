import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261012000000_add_structured_question_doubt_note.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question doubt note migration contract', () => {
  it('adds a nullable doubt_note column tied to doubt_flag with trim and length checks', () => {
    const sql = migrationSql();

    expect(sql).toContain('alter table public.structured_questions add column doubt_note text');
    expect(sql).toContain('doubt_note is null or doubt_flag');
    expect(sql).toContain("btrim(doubt_note) = doubt_note and doubt_note <> ''");
    expect(sql).toContain('char_length(doubt_note) <= 1000');
  });

  it('redefines the primitive and public RPC with doubt_note in the flag whitelist', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'create or replace function private.apply_structured_question_content( p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb )',
    );
    expect(sql).toContain('create or replace function public.mutate_structured_question(');
    expect(sql).toContain(
      "'__create', '__delete', 'doubt_flag', 'doubt_note', 'explanation_request_flag', 'is_active'",
    );
    expect(sql).toContain("where key not in ('doubt_flag', 'doubt_note', 'explanation_request_flag')");
    expect(sql).toContain("raise exception using errcode = '22023', message = 'doubt note requires doubt flag'");
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
  });

  it('reasserts least-privilege grants for both functions', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'revoke all on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) from public, anon, service_role',
    );
    expect(sql).toContain(
      'grant execute on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) to authenticated',
    );
    expect(sql).toContain(
      'revoke all on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb) from public, anon, service_role',
    );
    expect(sql).toContain(
      'grant execute on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb) to authenticated',
    );
  });
});
