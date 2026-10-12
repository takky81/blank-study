import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261012010000_add_structured_question_doubt_reasons.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question doubt reasons migration contract', () => {
  it('adds a non-null text[] doubt_reasons column restricted to the fixed codes', () => {
    const sql = migrationSql();
    expect(sql).toContain("alter table public.structured_questions add column doubt_reasons text[] not null default '{}'");
    expect(sql).toContain(
      "doubt_reasons <@ array['answer_guessable', 'low_value', 'defective', 'weak_distractors', 'unclear']::text[]",
    );
    for (const code of ['answer_guessable', 'low_value', 'defective', 'weak_distractors', 'unclear']) {
      expect(sql).toContain(`cardinality(array_positions(doubt_reasons, '${code}')) <= 1`);
    }
    expect(sql).not.toContain('create or replace function private.structured_question_doubt_reasons_valid');
    expect(sql).toContain("doubt_flag or doubt_reasons = '{}'");
  });

  it('redefines the primitive and public RPC with doubt_reasons in the flag whitelist', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'create or replace function private.apply_structured_question_content( p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb )',
    );
    expect(sql).toContain('create or replace function public.mutate_structured_question(');
    expect(sql).toContain(
      "'__create', '__delete', 'doubt_flag', 'doubt_note', 'doubt_reasons', 'explanation_request_flag', 'is_active'",
    );
    expect(sql).toContain("where key not in ('doubt_flag', 'doubt_note', 'doubt_reasons', 'explanation_request_flag')");
    expect(sql).toContain("raise exception using errcode = '22023', message = 'unknown doubt reason'");
    expect(sql).toContain("raise exception using errcode = '22023', message = 'doubt reasons require doubt flag'");
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
