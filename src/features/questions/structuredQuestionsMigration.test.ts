import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011000001_create_structured_questions.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('structured_questions migration contract', () => {
  it('defines the question master columns and database invariants', () => {
    const sql = migrationSql();

    expect(sql).toContain('create table public.structured_questions');
    expect(sql).toMatch(/question_text text not null check \(btrim\(question_text\) <> ''\)/);
    expect(sql).toMatch(/model_answer text not null check \(btrim\(model_answer\) <> ''\)/);
    expect(sql).toMatch(/choices jsonb not null default '\[\]'::jsonb/);
    expect(sql).toContain("jsonb_typeof(choices) = 'array'");
    expect(sql).toContain("@.type() != \"string\"");
    expect(sql).toMatch(/sort_order (integer|int) not null default 0 check \(sort_order >= 0\)/);
    expect(sql).toContain('is_active boolean not null default true');
    expect(sql).toContain('doubt_flag boolean not null default false');
    expect(sql).toContain('explanation_request_flag boolean not null default false');
    expect(sql).toMatch(/version bigint not null default 1 check \(version >= 1\)/);
    expect(sql).toContain('created_at timestamptz not null default now()');
    expect(sql).toContain('updated_at timestamptz not null default now()');
    expect(sql).toContain('new.version = old.version + 1');
    expect(sql).toContain('new.updated_at = now()');
  });

  it('enforces the keyword/material/owner relationship and deletion behavior', () => {
    const sql = migrationSql();

    expect(sql).toContain('unique (id, material_id, owner_id)');
    expect(sql).toContain('foreign key (keyword_id, material_id, owner_id)');
    expect(sql).toContain('references public.keywords (id, material_id, owner_id) on delete cascade');
    expect(sql).not.toMatch(/structured_questions[\s\S]*chapter_id/);
  });

  it('creates stable-list and flag lookup indexes', () => {
    const sql = migrationSql();

    expect(sql).toContain('on public.structured_questions (keyword_id, sort_order, id)');
    expect(sql).toContain(
      'on public.structured_questions (material_id, keyword_id, sort_order, id)',
    );
    expect(sql).toContain(
      'on public.structured_questions (owner_id, doubt_flag, explanation_request_flag)',
    );
  });
});
