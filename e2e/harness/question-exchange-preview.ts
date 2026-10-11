import { previewQuestionExchange } from '../../src/features/questionExchange/api';
import type { ImportPreview } from '../../src/features/questionExchange/preview';

/** 本番のimport preview read path（file読取→schema→SELECT snapshot→planner）をブラウザの認証sessionで実行する。 */
export async function runQuestionExchangePreview(json: string): Promise<ImportPreview> {
  return previewQuestionExchange(new Blob([json], { type: 'application/json' }));
}
