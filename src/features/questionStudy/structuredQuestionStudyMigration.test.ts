import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011010000_create_structured_question_study.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured question study migration contract', () => {
  it('defines dedicated question statistics with SRS invariants', () => {
    const sql = migrationSql();

    expect(sql).toContain('create table public.structured_question_stats');
    expect(sql).toMatch(/asked_count integer not null default 0 check \(asked_count >= 0\)/);
    expect(sql).toMatch(/correct_count integer not null default 0 check \(correct_count >= 0\)/);
    expect(sql).toContain('consecutive_correct integer not null default 0 check (consecutive_correct >= 0)');
    expect(sql).toContain('interval_days integer not null default 0 check (interval_days >= 0)');
    expect(sql).toContain('ease_factor numeric not null default 2.5 check (ease_factor >= 1.3)');
    expect(sql).toContain('constraint structured_question_stats_correct_le_asked check (correct_count <= asked_count)');
    expect(sql).toContain('due_at timestamptz');
    expect(sql).toContain('updated_at timestamptz not null default now()');
  });

  it('defines immutable-answer event data and valid answer modes', () => {
    const sql = migrationSql();

    expect(sql).toContain('create table public.structured_question_answer_logs');
    expect(sql).toContain('question_version bigint not null check (question_version >= 1)');
    expect(sql).toContain('answer text not null');
    expect(sql).toContain("mode text not null check (mode in ('choice', 'written'))");
    expect(sql).toContain('is_correct boolean not null');
    expect(sql).toContain('answered_at timestamptz not null default now()');
  });

  it('binds both dedicated tables to question and owner and cascades question deletion', () => {
    const sql = migrationSql();

    expect(sql).toContain('constraint structured_questions_id_owner_unique unique (id, owner_id)');
    expect(sql.match(/foreign key \(question_id, owner_id\)/g)).toHaveLength(2);
    expect(sql.match(/references public\.structured_questions \(id, owner_id\) on delete cascade/g)).toHaveLength(2);
  });

  it('adds stable due-date and answer-history indexes', () => {
    const sql = migrationSql();

    expect(sql).toContain('on public.structured_question_stats (owner_id, due_at, question_id)');
    expect(sql).toContain('on public.structured_question_answer_logs (owner_id, question_id, answered_at desc, id)');
  });

  it('does not reference or combine fill-in learning data', () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/\bkeyword_stats\b/);
    expect(sql).not.toMatch(/(?<!structured_question_)\banswer_logs\b/);
    expect(sql).not.toMatch(/\bunion\b/);
    expect(sql).not.toMatch(/create\s+(?:or\s+replace\s+)?view\b/);
  });
});
