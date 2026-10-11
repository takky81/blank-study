import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { adminClient, ensureTestUser, resetData, seedMaterialWithKeyword, seedSubject } from './db';
import { SUPABASE_ANON_KEY, SUPABASE_URL, TEST_USER } from './env';

const validContent = {
  question_text: 'RLSで保護される設問',
  model_answer: 'owner',
  choices: ['other'],
  explanation: null,
};

function queryCatalog(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_blank-study', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

type FunctionAcl = {
  identity: string;
  invoker: boolean;
  config: string[] | null;
  publicExecute: boolean;
  anonExecute: boolean;
  authenticatedExecute: boolean;
  serviceRoleExecute: boolean;
};

test.describe.serial('structured question security boundary', () => {
  test('catalog and local API enforce the owner-only delegation contract', async () => {
    const exposedSchemas = readFileSync('supabase/config.toml', 'utf8')
      .match(/^schemas\s*=\s*\[(.*)]/m)?.[1] ?? '';
    expect(exposedSchemas).not.toContain('private');

    const catalog = queryCatalog(`
      select jsonb_build_object(
        'policies', (select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'structured_questions'),
        'primitive_invoker', not p.prosecdef,
        'primitive_args', pg_get_function_identity_arguments(p.oid),
        'primitive_config', p.proconfig,
        'authenticated_execute', has_function_privilege(
          'authenticated', p.oid, 'EXECUTE'),
        'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
        'authenticated_private_usage', has_schema_privilege(
          'authenticated', 'private', 'USAGE'),
        'anon_private_usage', has_schema_privilege('anon', 'private', 'USAGE'),
        'service_role_private_usage', has_schema_privilege('service_role', 'private', 'USAGE'),
        'authenticated_lock_execute', has_function_privilege(
          'authenticated', 'private.lock_structured_question_keyword_set()', 'EXECUTE'),
        'mutate_invoker', not m.prosecdef,
        'service_role_mutate_execute', has_function_privilege('service_role', m.oid, 'EXECUTE'),
        'mutate_config', m.proconfig,
        'reorder_invoker', not r.prosecdef,
        'service_role_reorder_execute', has_function_privilege('service_role', r.oid, 'EXECUTE'),
        'reorder_config', r.proconfig
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join pg_proc m
      cross join pg_proc r
      where n.nspname = 'private'
        and p.proname = 'apply_structured_question_content'
        and m.oid = 'public.mutate_structured_question(text,uuid,uuid,bigint,jsonb,jsonb)'::regprocedure
        and r.oid = 'public.reorder_structured_questions(uuid,jsonb)'::regprocedure;
    `);
    expect(JSON.parse(catalog)).toMatchObject({
      policies: 4,
      primitive_invoker: true,
      primitive_args: 'p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb',
      primitive_config: ['search_path=""'],
      authenticated_execute: true,
      anon_execute: false,
      service_role_execute: false,
      authenticated_private_usage: true,
      anon_private_usage: false,
      service_role_private_usage: false,
      authenticated_lock_execute: false,
      mutate_invoker: true,
      service_role_mutate_execute: false,
      mutate_config: ['search_path=""'],
      reorder_invoker: true,
      service_role_reorder_execute: false,
      reorder_config: ['search_path=""'],
    });

    const functionAcls = JSON.parse(queryCatalog(`
      select jsonb_agg(jsonb_build_object(
        'identity', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'invoker', not p.prosecdef,
        'config', p.proconfig,
        'publicExecute', coalesce((select bool_or(grantee = 0 and privilege_type = 'EXECUTE')
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))), false),
        'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'serviceRoleExecute', has_function_privilege('service_role', p.oid, 'EXECUTE')
      ) order by n.nspname, p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname, p.proname) in (
        ('public', 'set_structured_question_version'),
        ('public', 'mutate_structured_question'),
        ('public', 'reorder_structured_questions'),
        ('private', 'apply_structured_question_content'),
        ('private', 'lock_structured_question_keyword_set')
      );
    `)) as FunctionAcl[];
    expect(functionAcls).toHaveLength(5);
    expect(functionAcls).toEqual([
      {
        identity: 'private.apply_structured_question_content(p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb)',
        invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false,
        authenticatedExecute: true, serviceRoleExecute: false,
      },
      {
        identity: 'private.lock_structured_question_keyword_set()',
        invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false,
        authenticatedExecute: false, serviceRoleExecute: false,
      },
      {
        identity: 'public.mutate_structured_question(p_command text, p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb)',
        invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false,
        authenticatedExecute: true, serviceRoleExecute: false,
      },
      {
        identity: 'public.reorder_structured_questions(p_keyword_id uuid, p_ordered jsonb)',
        invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false,
        authenticatedExecute: true, serviceRoleExecute: false,
      },
      {
        identity: 'public.set_structured_question_version()',
        invoker: true, config: ['search_path=""'], publicExecute: false, anonExecute: false,
        authenticatedExecute: false, serviceRoleExecute: false,
      },
    ]);

    const ownerId = await ensureTestUser();
    await resetData(ownerId);
    const ownerSubject = await seedSubject(ownerId, 'security owner');
    const ownerKeyword = await seedMaterialWithKeyword(ownerId, ownerSubject, 'sec001');

    const otherEmail = `question-security-${randomUUID()}@example.com`;
    const otherPassword = 'test-password-123';
    const createdOther = await adminClient().auth.admin.createUser({
      email: otherEmail,
      password: otherPassword,
      email_confirm: true,
    });
    if (createdOther.error) throw createdOther.error;
    const otherId = createdOther.data.user.id;

    try {
      const otherSubject = await seedSubject(otherId, 'security other');
      const otherKeyword = await seedMaterialWithKeyword(otherId, otherSubject, 'sec002');
      const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const otherClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await ownerClient.auth.signInWithPassword(TEST_USER)).error).toBeNull();
      expect((await otherClient.auth.signInWithPassword({
        email: otherEmail, password: otherPassword,
      })).error).toBeNull();

      const ownerCreated = await ownerClient.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: ownerKeyword.keywordId, p_content: validContent,
      });
      expect(ownerCreated.error).toBeNull();
      const ownerQuestionId = (ownerCreated.data as { question: { id: string } }).question.id;

      const otherCreated = await otherClient.rpc('mutate_structured_question', {
        p_command: 'create', p_keyword_id: otherKeyword.keywordId, p_content: validContent,
      });
      expect(otherCreated.error).toBeNull();
      const otherQuestionId = (otherCreated.data as { question: { id: string } }).question.id;

      const ownerRows = await ownerClient.from('structured_questions').select('id');
      expect(ownerRows.error).toBeNull();
      expect(ownerRows.data).toEqual([{ id: ownerQuestionId }]);

      const crossOwnerUpdate = await ownerClient.from('structured_questions')
        .update({ question_text: '変更してはいけない' })
        .eq('id', otherQuestionId)
        .select('id');
      expect(crossOwnerUpdate.error).toBeNull();
      expect(crossOwnerUpdate.data).toEqual([]);

      const crossOwnerRpc = await ownerClient.rpc('mutate_structured_question', {
        p_command: 'set-active', p_question_id: otherQuestionId, p_expected_version: 1,
        p_flag_patch: { is_active: false },
      });
      expect(crossOwnerRpc.error).not.toBeNull();

      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await anonClient.from('structured_questions').select('id')).error).not.toBeNull();
      expect((await anonClient.rpc('mutate_structured_question', {
        p_command: 'set-active', p_question_id: ownerQuestionId, p_expected_version: 1,
        p_flag_patch: { is_active: false },
      })).error).not.toBeNull();

      for (const client of [anonClient, ownerClient]) {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_structured_question_content`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token ?? SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        expect(response.status).toBe(404);
      }
    } finally {
      await resetData(otherId);
      await adminClient().auth.admin.deleteUser(otherId);
      await resetData(ownerId);
    }
  });
});
