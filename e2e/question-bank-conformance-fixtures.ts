import { readFileSync } from 'node:fs';

export type QuestionContentCase = {
  name: string;
  valid: boolean;
  content: Record<string, unknown>;
  expected?: Record<string, unknown>;
};

/**
 * 通常編集と下流 exchange が委譲する primitive の双方へ渡す、bank 所有の適合 fixture。
 * JSON は PostgreSQL 側の regression asset と共有し、片方だけ検証規則がずれるのを防ぐ。
 */
export const questionContentCases = JSON.parse(
  readFileSync('supabase/tests/fixtures/structured_question_mutation_cases.json', 'utf8'),
) as QuestionContentCase[];

export const validQuestionContentCases = questionContentCases.filter(({ valid }) => valid);
export const invalidQuestionContentCases = questionContentCases.filter(({ valid }) => !valid);

export function questionContent(label: string): Record<string, unknown> {
  return {
    question_text: `${label}とは何か`,
    model_answer: `${label}の答え`,
    choices: [`${label}の誤答`],
    explanation: null,
  };
}
