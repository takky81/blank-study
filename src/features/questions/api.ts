import { fetchAll } from '@/lib/paged';
import { supabase } from '@/lib/supabase';
import type { StructuredQuestion } from './types';

const QUESTION_COLUMNS =
  'id, owner_id, material_id, keyword_id, question_text, model_answer, choices, explanation, sort_order, is_active, doubt_flag, explanation_request_flag, version, created_at, updated_at';

type StructuredQuestionRow = {
  id: string;
  owner_id: string;
  material_id: string;
  keyword_id: string;
  question_text: string;
  model_answer: string;
  choices: string[];
  explanation: string | null;
  sort_order: number;
  is_active: boolean;
  doubt_flag: boolean;
  explanation_request_flag: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export function mapStructuredQuestionRow(row: StructuredQuestionRow): StructuredQuestion {
  return {
    id: row.id,
    ownerId: row.owner_id,
    materialId: row.material_id,
    keywordId: row.keyword_id,
    questionText: row.question_text,
    modelAnswer: row.model_answer,
    choices: row.choices,
    explanation: row.explanation,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    doubtFlag: row.doubt_flag,
    explanationRequestFlag: row.explanation_request_flag,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export async function listQuestionsByKeyword(keywordId: string): Promise<StructuredQuestion[]> {
  return readQuestions('keyword_id', keywordId, ['sort_order', 'id']);
}

export async function listQuestionsByMaterial(materialId: string): Promise<StructuredQuestion[]> {
  return readQuestions('material_id', materialId, ['keyword_id', 'sort_order', 'id']);
}

async function readQuestions(
  filter: 'keyword_id' | 'material_id',
  id: string,
  order: readonly string[],
): Promise<StructuredQuestion[]> {
  const rows = await fetchAll<StructuredQuestionRow>(async (from, to) => {
    let query = supabase
      .from('structured_questions')
      .select(QUESTION_COLUMNS, { count: 'exact' })
      .eq(filter, id);
    for (const column of order) query = query.order(column);
    const page = await query.range(from, to);
    if (page.error) {
      throw new Error(`設問の取得に失敗しました: ${page.error.message}`);
    }
    return { rows: (page.data ?? []) as StructuredQuestionRow[], total: page.count };
  });
  return rows.map(mapStructuredQuestionRow);
}
