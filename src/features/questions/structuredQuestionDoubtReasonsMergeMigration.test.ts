import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOUBT_REASON_CODES } from './doubtReasons';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261012020000_merge_doubt_reason_weak_distractors.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question doubt reason merge migration contract', () => {
  it('keeps the app code list in sync with the 4 DB codes', () => {
    expect(DOUBT_REASON_CODES).toEqual(['answer_guessable', 'low_value', 'defective', 'unclear']);
  });

  it('normalizes weak_distractors rows into answer_guessable without bumping version', () => {
    const sql = migrationSql();
    const disable = sql.indexOf('disable trigger structured_questions_set_version');
    const update = sql.indexOf('update public.structured_questions as q');
    const enable = sql.indexOf('enable trigger structured_questions_set_version');
    expect(disable).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(disable);
    expect(enable).toBeGreaterThan(update);
    expect(sql).toContain("array_replace(q.doubt_reasons, 'weak_distractors', 'answer_guessable')");
    expect(sql).toContain("where 'weak_distractors' = any(q.doubt_reasons)");
  });

  it('replaces the check constraint with only the 4 codes and no helper function', () => {
    const sql = migrationSql();
    expect(sql).toContain('drop constraint structured_questions_doubt_reasons_check');
    expect(sql).toContain(
      "doubt_reasons <@ array['answer_guessable', 'low_value', 'defective', 'unclear']::text[]",
    );
    for (const code of ['answer_guessable', 'low_value', 'defective', 'unclear']) {
      expect(sql).toContain(`cardinality(array_positions(doubt_reasons, '${code}')) <= 1`);
    }
    expect(sql).not.toContain("array_positions(doubt_reasons, 'weak_distractors')");
    expect(sql).toContain("doubt_flag or doubt_reasons = '{}'");
    expect(sql).not.toMatch(/create (or replace )?function private\.(?!apply_structured_question_content\()/);
  });

  it('redefines the primitive with the 4-code list and reasserts grants', () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'create or replace function private.apply_structured_question_content( p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb )',
    );
    expect(sql).toContain("not in ( 'answer_guessable', 'low_value', 'defective', 'unclear' )");
    expect(sql).toContain("unnest(array['answer_guessable', 'low_value', 'defective', 'unclear']::text[])");
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      'revoke all on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) from public, anon, service_role',
    );
    expect(sql).toContain(
      'grant execute on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) to authenticated',
    );
  });
});
