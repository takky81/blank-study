import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261011010001_record_structured_question_answer.sql',
);

function migrationSql(): string {
  return readFileSync(migrationPath, 'utf8').replaceAll(/\s+/g, ' ').toLowerCase();
}

describe('record structured question answer migration contract', () => {
  it('locks an owned active question and returns a non-disclosing conflict for stale input', () => {
    const sql = migrationSql();

    expect(sql).toContain('create or replace function public.record_structured_question_answer');
    expect(sql).toContain('where id = p_question_id and owner_id = v_actor and is_active = true');
    expect(sql).toContain('for update');
    expect(sql).toContain("return jsonb_build_object('kind', 'question-conflict')");
    expect(sql).not.toMatch(/question-conflict[^;]*(question_text|model_answer|version)/);
  });

  it('derives correctness from the stored model answer using shared normalization semantics', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/replace\(v_question\.model_answer,\s*'\s*',\s*' '\)/);
    expect(sql).toMatch(/replace\(p_answer,\s*'\s*',\s*' '\)/);
    expect(sql).toContain('v_is_correct := v_normalized_answer <>');
    expect(sql).toContain('and v_normalized_answer = v_normalized_model_answer');
    expect(sql).not.toMatch(/p_is_correct|p_interval_days|p_ease_factor|p_due_at/);
  });

  it('inserts exactly one log and upserts stats from the locked latest state', () => {
    const sql = migrationSql();

    expect(sql).toContain('from public.structured_question_stats');
    expect(sql).toContain('where question_id = p_question_id and owner_id = v_actor');
    expect(sql).toContain('for update');
    expect(sql).toContain('insert into public.structured_question_answer_logs');
    expect(sql).toContain('insert into public.structured_question_stats');
    expect(sql).toContain('on conflict (question_id) do update');
    expect(sql).toContain("jsonb_build_object('kind', 'recorded'");
    expect(sql).toContain("'logid', v_log_id");
    expect(sql).toContain("'stats', to_jsonb(v_stats)");
  });

  it('implements the existing SRS constants and current-time due date inside one RPC transaction', () => {
    const sql = migrationSql();

    expect(sql).toContain('v_next_ease_factor := greatest(1.3');
    expect(sql).toContain('v_next_interval_days := 1');
    expect(sql).toContain('v_next_interval_days := 6');
    expect(sql).toContain('floor((v_current_interval_days * v_current_ease_factor) + 0.5)');
    expect(sql).toContain("v_due_at := v_now + make_interval(days => v_next_interval_days)");
    expect(sql).toMatch(/exception when others then .* raise;/);
  });
});
