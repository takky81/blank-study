import {
  listQuestionsByKeyword,
  structuredQuestionReadContract,
} from '../../src/features/questions/api';

/**
 * 本番の公開読取APIと下流consumer契約を、ブラウザの認証sessionで実行する。
 */
export async function readQuestionVolume(keywordId: string, materialId: string): Promise<{
  keywordIds: string[];
  materialIds: string[];
}> {
  const [byKeyword, byMaterial] = await Promise.all([
    listQuestionsByKeyword(keywordId),
    structuredQuestionReadContract.listQuestionsByMaterial(materialId),
  ]);

  return {
    keywordIds: byKeyword.map(({ id }) => id),
    materialIds: byMaterial.map(({ id }) => id),
  };
}
