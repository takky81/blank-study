import { exportEligibleQuestions, type EligibilityExportResult } from '../../src/features/questionExchange/api';
import { serializeExchangeExport } from '../../src/features/questionExchange/schema';
import type { EligibilityFilter } from '../../src/features/questionExchange/types';

/**
 * 本番の設問交換export path（eligibility RPC → catalog/設問読取 → projection → schema v1）を、
 * ブラウザの認証sessionで実行する。headerは比較できるよう固定値を注入する。
 */
export async function runEligibilityExport(
  filter: EligibilityFilter,
  header: { exchangeId: string; exportedAt: string },
): Promise<{ result: EligibilityExportResult; serialized: string | null }> {
  const result = await exportEligibleQuestions(filter, {
    createExchangeId: () => header.exchangeId,
    now: () => new Date(header.exportedAt),
  });
  return { result, serialized: result.kind === 'export' ? serializeExchangeExport(result.value) : null };
}
