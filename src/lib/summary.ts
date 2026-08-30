/**
 * 一覧に出す件数の集計。
 *
 * 教材ごとの章数・キーワード数・解答実績は、行を引いて手元で数えると
 * 1リクエストの行数上限（§5.2）に当たって数え落とす。数える処理は
 * material_summary（RPC）に置き、ここは呼び出しと型合わせだけを行う。
 */

import { supabase } from '@/lib/supabase';

export type MaterialSummary = {
  materialId: string;
  subjectId: string;
  chapterCount: number;
  keywordCount: number;
  totalCount: number;
  correctCount: number;
  dueCount: number;
};

/** その日の終わり。「今日までに復習するもの」の境目は利用者の時間帯で決まる。 */
export function endOfDay(now: Date = new Date()): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** RPC が返す行。件数は bigint なので、数値に直してから使う。 */
type SummaryRow = {
  material_id: string;
  subject_id: string;
  chapter_count: number | string;
  keyword_count: number | string;
  total_count: number | string;
  correct_count: number | string;
  due_count: number | string;
};

/** 教材ごとの集計を引く。見える教材は RLS が決める。 */
export async function fetchMaterialSummary(now: Date = new Date()): Promise<MaterialSummary[]> {
  const { data, error } = await supabase.rpc('material_summary', {
    p_due_before: endOfDay(now).toISOString(),
  });
  if (error) throw new Error(`件数の取得に失敗しました: ${error.message}`);

  return ((data ?? []) as SummaryRow[]).map((row) => ({
    materialId: row.material_id,
    subjectId: row.subject_id,
    chapterCount: Number(row.chapter_count),
    keywordCount: Number(row.keyword_count),
    totalCount: Number(row.total_count),
    correctCount: Number(row.correct_count),
    dueCount: Number(row.due_count),
  }));
}
