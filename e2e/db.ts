import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, TEST_USER } from './env';

/** ローカル Supabase の service_role キーを取り出す。E2E の後片付けに使う。 */
export function serviceRoleKey(): string {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const status = JSON.parse(out) as { SERVICE_ROLE_KEY: string };
  return status.SERVICE_ROLE_KEY;
}

let admin: SupabaseClient | null = null;

/** RLS を迂回する管理用クライアント。テストの前準備と後片付けだけに使う。 */
export function adminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(SUPABASE_URL, serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/** E2E 用ユーザーの id を返す。無ければ作る。 */
export async function ensureTestUser(): Promise<string> {
  const db = adminClient();
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw error;

  const existing = data.users.find((u) => u.email === TEST_USER.email);
  if (existing) return existing.id;

  const created = await db.auth.admin.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}

/**
 * E2E 用ユーザーのデータを消す。
 * subjects を消せば配下は連鎖して消える（仕様書 §3.7）。
 * 教材に属さないキーワードは無いため、これで全部きれいになる。
 */
export async function resetData(ownerId: string): Promise<void> {
  const db = adminClient();
  const { error } = await db.from('subjects').delete().eq('owner_id', ownerId);
  if (error) throw error;
}

/** 科目を1件作る。テストの前準備用。 */
export async function seedSubject(ownerId: string, name: string, sortOrder = 0): Promise<string> {
  const { data, error } = await adminClient()
    .from('subjects')
    .insert({ name, owner_id: ownerId, sort_order: sortOrder })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** 教材・章・キーワード・解答履歴を1組ずつ作る。削除の確認で件数を見せるため。 */
export async function seedMaterialWithKeyword(
  ownerId: string,
  subjectId: string,
  docId = 'k71m2p',
): Promise<{ materialId: string; chapterId: string; keywordId: string }> {
  const db = adminClient();
  const material = await db
    .from('materials')
    .insert({ name: 'テクノロジ系', subject_id: subjectId, owner_id: ownerId })
    .select('id')
    .single();
  if (material.error) throw material.error;

  const chapter = await db
    .from('chapters')
    .insert({ material_id: material.data.id, owner_id: ownerId, title: '基礎理論' })
    .select('id')
    .single();
  if (chapter.error) throw chapter.error;

  const keyword = await db
    .from('keywords')
    .insert({
      material_id: material.data.id,
      chapter_id: chapter.data.id,
      owner_id: ownerId,
      doc_id: docId,
      answers: ['ビット'],
      tags: ['単位'],
    })
    .select('id')
    .single();
  if (keyword.error) throw keyword.error;

  const log = await db.from('answer_logs').insert({
    keyword_id: keyword.data.id,
    owner_id: ownerId,
    format: 'text',
    input: 'ビット',
    is_correct: true,
  });
  if (log.error) throw log.error;

  return {
    materialId: material.data.id as string,
    chapterId: chapter.data.id as string,
    keywordId: keyword.data.id as string,
  };
}

/** テーブルの件数を数える。連鎖削除の確認に使う。 */
export async function countRows(table: string, ownerId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', ownerId);
  if (error) throw error;
  return count ?? 0;
}
