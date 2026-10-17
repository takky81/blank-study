/**
 * RpcSecurityMatrix: authenticated利用者に公開されるuser-data RPCの完全な一覧。
 * DB catalogから自動列挙した集合とこのfixtureが完全一致することを各security specで検証する。
 * 新しい公開RPCを追加した場合は、ここへ追記し4主体の権限テストを用意すること。
 */
export const RPC_SECURITY_MATRIX = [
  'import_material(p_subject_id uuid, p_material_id uuid, p_material_name text, p_parent_id uuid, p_chapters jsonb, p_keywords jsonb)',
  'material_summary(p_due_before timestamp with time zone)',
  'mutate_structured_question(p_command text, p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb)',
  'record_structured_question_answer(p_question_id uuid, p_expected_question_version bigint, p_answer text, p_mode text, p_answered_at timestamp with time zone)',
  'reorder_structured_questions(p_keyword_id uuid, p_ordered jsonb)',
  'sync_active_keywords(p_material_id uuid, p_doc_ids text[])',
  // question-generation-exchange: owner付きeligibility集計（4主体の権限テストはtask 5.3で追加）
  'get_question_exchange_candidates(p_minimum_attempts numeric, p_maximum_accuracy numeric, p_maximum_question_count numeric, p_require_wrong boolean)',
  // question-generation-exchange: atomic import orchestration（task 4.1）
  'import_question_exchange(p_payload jsonb)',
] as const;

/** 公開schemaでauthenticatedがEXECUTEできる非trigger関数をcatalogから列挙するSQL。 */
export const PUBLIC_RPC_CATALOG_SQL = `
  select coalesce(jsonb_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname), '[]')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
`;
