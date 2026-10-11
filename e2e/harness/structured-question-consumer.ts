import {
  flagMutationContract,
  structuredQuestionReadContract,
} from '../../src/features/questions/api';
import type { StructuredQuestionConsumerView } from '../../src/features/questions/types';

export async function exerciseQuestionConsumer(materialId: string): Promise<{
  initial: StructuredQuestionConsumerView;
  bothSet: StructuredQuestionConsumerView;
  doubtCleared: StructuredQuestionConsumerView;
  explanationCleared: StructuredQuestionConsumerView;
  stale: Awaited<ReturnType<typeof flagMutationContract.setQuestionFlags>>;
  error: string;
}> {
  const initial = (await structuredQuestionReadContract.listQuestionsByMaterial(materialId))[0];
  if (!initial) throw new Error('設問が見つかりません');

  const doubt = await flagMutationContract.setQuestionFlags(initial.id, initial.version, {
    doubtFlag: true,
  });
  if (doubt.kind !== 'saved') throw new Error('疑義flagを設定できませんでした');
  const explanation = await flagMutationContract.setQuestionFlags(doubt.question.id, doubt.question.version, {
    explanationRequestFlag: true,
  });
  if (explanation.kind !== 'saved') throw new Error('解説追加flagを設定できませんでした');
  const doubtCleared = await flagMutationContract.setQuestionFlags(
    explanation.question.id,
    explanation.question.version,
    { doubtFlag: false },
  );
  if (doubtCleared.kind !== 'saved') throw new Error('疑義flagを解除できませんでした');
  const explanationCleared = await flagMutationContract.setQuestionFlags(
    doubtCleared.question.id,
    doubtCleared.question.version,
    { explanationRequestFlag: false },
  );
  if (explanationCleared.kind !== 'saved') throw new Error('解説追加flagを解除できませんでした');
  const stale = await flagMutationContract.setQuestionFlags(initial.id, initial.version, {
    doubtFlag: true,
  });
  const error = await flagMutationContract.setQuestionFlags(
    '00000000-0000-0000-0000-000000000000',
    1,
    { doubtFlag: true },
  ).then(
    () => 'unexpected success',
    (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
  );

  return {
    initial,
    bothSet: explanation.question,
    doubtCleared: doubtCleared.question,
    explanationCleared: explanationCleared.question,
    stale,
    error,
  };
}
