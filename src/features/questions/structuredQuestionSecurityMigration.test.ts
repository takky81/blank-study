import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20261011000004_secure_structured_question_access.sql';
const sql = readFileSync(migrationPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');

describe('structured question security migration contract', () => {
  it('applies owner-scoped RLS for every Data API operation', () => {
    expect(sql).toContain('alter table public.structured_questions enable row level security');
    expect(sql).toMatch(/for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = owner_id\)/);
    expect(sql).toMatch(/for insert\s+to authenticated\s+with check \(\(select auth\.uid\(\)\) = owner_id\)/);
    expect(sql).toMatch(/for update\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = owner_id\)\s+with check \(\(select auth\.uid\(\)\) = owner_id\)/);
    expect(sql).toMatch(/for delete\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = owner_id\)/);
  });

  it('limits table and public RPC access to authenticated', () => {
    expect(sql).toContain('revoke all on table public.structured_questions from public, anon');
    expect(sql).toContain('grant select, insert, update, delete on table public.structured_questions to authenticated');
    expect(sql).toContain('revoke all on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb) from public, anon, service_role');
    expect(sql).toContain('grant execute on function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb) to authenticated');
    expect(sql).toContain('revoke all on function public.reorder_structured_questions(uuid, jsonb) from public, anon, service_role');
    expect(sql).toContain('grant execute on function public.reorder_structured_questions(uuid, jsonb) to authenticated');
  });

  it('grants only the exact private primitive delegation capability', () => {
    expect(sql).toContain('revoke all on schema private from public, anon, service_role');
    expect(sql).toContain('grant usage on schema private to authenticated');
    expect(sql).toContain('revoke all on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) from public, anon, service_role');
    expect(sql).toContain('grant execute on function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) to authenticated');
    expect(sql).not.toMatch(/grant execute on all functions in schema private/);
  });

  it('revokes trigger helpers from every Data API role', () => {
    expect(sql).toContain('revoke all on function public.set_structured_question_version() from public, anon, authenticated, service_role');
    expect(sql).toContain('revoke all on function private.lock_structured_question_keyword_set() from public, anon, authenticated, service_role');
  });

  it('explicitly preserves invoker and empty search paths', () => {
    expect(sql).toContain('alter function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) security invoker');
    expect(sql).toContain("alter function private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb) set search_path = ''");
    expect(sql).toContain('alter function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb) security invoker');
    expect(sql).toContain("alter function public.mutate_structured_question(text, uuid, uuid, bigint, jsonb, jsonb) set search_path = ''");
    expect(sql).toContain('alter function public.reorder_structured_questions(uuid, jsonb) security invoker');
    expect(sql).toContain("alter function public.reorder_structured_questions(uuid, jsonb) set search_path = ''");
  });
});
