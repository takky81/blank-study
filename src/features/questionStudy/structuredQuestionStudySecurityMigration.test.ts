import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011010002_secure_structured_question_study.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question study security migration contract', () => {
  it.each([
    'structured_question_stats',
    'structured_question_answer_logs',
  ])('applies an authenticated owner boundary to %s', (table) => {
    const sql = migrationSql();

    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(
      `create policy ${table}_owner_select on public.${table} for select to authenticated using ((select auth.uid()) = owner_id)`,
    );
    expect(sql).toContain(
      `create policy ${table}_owner_insert on public.${table} for insert to authenticated with check ((select auth.uid()) = owner_id)`,
    );
  });

  it('allows only owner-scoped RPC operations and keeps answer events immutable', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'create policy structured_question_stats_owner_update on public.structured_question_stats for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
    );
    expect(sql).toContain(
      'grant select, insert, update on table public.structured_question_stats to authenticated',
    );
    expect(sql).toContain(
      'grant select, insert on table public.structured_question_answer_logs to authenticated',
    );
    expect(sql).not.toMatch(/grant [^;]*(delete|truncate|references|trigger)[^;]*structured_question_(stats|answer_logs)/);
    expect(sql).not.toMatch(/grant [^;]*update[^;]*structured_question_answer_logs/);
  });

  it('does not expose study data to anonymous callers and reserves service role for administration', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'revoke all on table public.structured_question_stats from public, anon',
    );
    expect(sql).toContain(
      'revoke all on table public.structured_question_answer_logs from public, anon',
    );
    expect(sql).toContain(
      'grant all on table public.structured_question_stats, public.structured_question_answer_logs to service_role',
    );
  });

  it('hardens the public record RPC for authenticated invoker-only execution', () => {
    const sql = migrationSql();
    const signature =
      'public.record_structured_question_answer(uuid, bigint, text, text, timestamptz)';

    expect(sql).toContain(`revoke all on function ${signature} from public, anon, service_role`);
    expect(sql).toContain(`grant execute on function ${signature} to authenticated`);
    expect(sql).toContain(`alter function ${signature} security invoker`);
    expect(sql).toContain(`alter function ${signature} set search_path = ''`);
  });
});
