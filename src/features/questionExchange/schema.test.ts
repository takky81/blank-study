import { describe, expect, it } from 'vitest';
import golden from './fixtures/question-exchange-v1.export.json';
import {
  buildExchangeExport,
  createUpdateOperation,
  parseExchangeExport,
  parseExchangeImport,
  serializeExchangeExport,
  serializeExchangeImport,
  toExchangeTarget,
} from './schema';
import type { EligibilityTarget, QuestionExchangeExportV1, QuestionExchangeImportV1 } from './types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const goldenText = JSON.stringify(golden);
const header = { schemaVersion: 1, exchangeId: golden.exchangeId, exportedAt: golden.exportedAt } as const;
const K1 = golden.targets[0]!.keyword.id;
const Q1 = '50000000-0000-4000-8000-000000000001';

function errorsOf(result: ReturnType<typeof parseExchangeExport> | ReturnType<typeof parseExchangeImport>) {
  if (result.ok) throw new Error('expected failure');
  return result.errors;
}

function mutatedExport(mutate: (draft: any) => void) {
  const draft = clone(golden) as any;
  mutate(draft);
  return parseExchangeExport(JSON.stringify(draft));
}

const draftQuestion = { questionText: '問', modelAnswer: '答', choices: [], explanation: null };
const validImport = (): any => ({
  ...header,
  operations: [
    { kind: 'create', keywordId: K1, question: draftQuestion },
    {
      kind: 'update',
      keywordId: K1,
      questionId: Q1,
      expectedVersion: 2,
      question: { ...draftQuestion, explanation: '解説' },
      sourceRequestedFlags: ['doubt', 'explanation-request'],
      resolvedFlags: ['explanation-request'],
    },
  ],
});

describe('export schema v1（golden fixture）', () => {
  it('golden fixtureを成功値として読み込み、全fieldを保持する', () => {
    const result = parseExchangeExport(goldenText);
    expect(result).toEqual({ ok: true, value: golden });
  });

  it('serialize→parseのround tripで同じ値に戻り、UTF-8バイト列からも読める', () => {
    const parsed = parseExchangeExport(goldenText);
    if (!parsed.ok) throw new Error('golden invalid');
    const text = serializeExchangeExport(parsed.value);
    expect(parseExchangeExport(text)).toEqual({ ok: true, value: golden });
    expect(parseExchangeExport(new TextEncoder().encode(text))).toEqual({ ok: true, value: golden });
  });

  it('nullは正答率と解説だけで許容し、配列の該当なしは空配列のまま保持する', () => {
    expect(golden.targets[1]!.metrics.accuracy).toBeNull();
    expect(golden.targets[0]!.questions[0]!.explanation).toBeNull();
    expect(golden.targets[1]!.chapterContexts).toEqual([]);
    expect(errorsOf(mutatedExport((d) => (d.targets[1].chapterContexts = null)))).toEqual([
      { path: '$.targets[1].chapterContexts', message: expect.any(String) },
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].keyword.modelAnswer = null)))).toEqual([
      { path: '$.targets[0].keyword.modelAnswer', message: expect.any(String) },
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[1].choices = null))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[1].choices',
    ]);
  });

  it('疑義の内容は文字列またはnullで、keyは必須とする', () => {
    expect(golden.targets[0]!.questions[0]!.doubtNote).toBe('選択肢に模範解答が含まれている');
    expect(golden.targets[0]!.questions[1]!.doubtNote).toBeNull();
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[0].doubtNote = 1))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].doubtNote',
    ]);
    expect(errorsOf(mutatedExport((d) => delete d.targets[0].questions[0].doubtNote)).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].doubtNote',
    ]);
  });

  it('疑義の理由は固定コードを正規順・重複なしで持ち、keyは必須とする', () => {
    expect(golden.targets[0]!.questions[0]!.doubtReasons).toEqual(['answer_guessable', 'unclear']);
    expect(golden.targets[0]!.questions[1]!.doubtReasons).toEqual([]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[0].doubtReasons = ['unknown']))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].doubtReasons[0]',
    ]);
    // weak_distractors は answer_guessable へ統合済みで、もう受け付けない
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[0].doubtReasons = ['weak_distractors']))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].doubtReasons[0]',
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[0].doubtReasons = ['unclear', 'answer_guessable']))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].doubtReasons[1]',
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[0].doubtReasons = ['unclear', 'unclear']))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].doubtReasons[1]',
    ]);
    expect(errorsOf(mutatedExport((d) => delete d.targets[0].questions[0].doubtReasons)).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].doubtReasons',
    ]);
  });

  it('追加memberと必須member欠落を正確なpathで拒否する', () => {
    expect(errorsOf(mutatedExport((d) => (d.extra = 1)))).toEqual([{ path: '$.extra', message: expect.any(String) }]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].chapterContexts[0].chapter.note = 'x'))).map((e) => e.path)).toEqual([
      '$.targets[0].chapterContexts[0].chapter.note',
    ]);
    expect(errorsOf(mutatedExport((d) => delete d.targets[0].metrics.wrong)).map((e) => e.path)).toEqual([
      '$.targets[0].metrics.wrong',
    ]);
  });

  it('schema版、UUID、日時、整数・範囲の型違反を拒否する', () => {
    expect(errorsOf(mutatedExport((d) => (d.schemaVersion = 2))).map((e) => e.path)).toEqual(['$.schemaVersion']);
    expect(errorsOf(mutatedExport((d) => (d.exchangeId = 'abc'))).map((e) => e.path)).toEqual(['$.exchangeId']);
    expect(errorsOf(mutatedExport((d) => (d.exportedAt = '2026-10-11 09:30'))).map((e) => e.path)).toEqual(['$.exportedAt']);
    expect(errorsOf(mutatedExport((d) => (d.filters.maximumAccuracy = 1.5))).map((e) => e.path)).toEqual([
      '$.filters.maximumAccuracy',
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[0].expectedVersion = 0))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[0].expectedVersion',
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].metrics.attempts = 1.5))).map((e) => e.path)).toEqual([
      '$.targets[0].metrics.attempts',
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].reasons = ['unknown']))).map((e) => e.path)).toEqual([
      '$.targets[0].reasons[0]',
    ]);
  });

  it('target/path/question/flagの安定順違反と列挙の重複をpath付きで拒否する', () => {
    expect(errorsOf(mutatedExport((d) => d.targets.reverse())).map((e) => e.path)).toEqual(['$.targets[1]']);
    expect(errorsOf(mutatedExport((d) => d.targets[0].chapterContexts.reverse())).map((e) => e.path)).toEqual([
      '$.targets[0].chapterContexts[1]',
    ]);
    expect(errorsOf(mutatedExport((d) => d.targets[0].questions.reverse())).map((e) => e.path)).toContain(
      '$.targets[0].questions[1]',
    );
    expect(errorsOf(mutatedExport((d) => d.targets[0].reasons.reverse())).map((e) => e.path)).toContain('$.targets[0].reasons[1]');
    expect(
      errorsOf(
        mutatedExport((d) => {
          d.targets[0].questions[0].requestedFlags = ['explanation-request', 'doubt'];
          d.targets[0].flaggedQuestions[0].requestKinds = ['explanation-request', 'doubt'];
        }),
      ).map((e) => e.path),
    ).toEqual(['$.targets[0].questions[0].requestedFlags[1]', '$.targets[0].flaggedQuestions[0].requestKinds[1]']);
  });

  it('requestedFlagsとflaggedQuestions.requestKindsの不一致を拒否する', () => {
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[1].requestedFlags = ['doubt']))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[1].requestedFlags',
    ]);
    expect(errorsOf(mutatedExport((d) => (d.targets[0].questions[2].requestedFlags = []))).map((e) => e.path)).toEqual([
      '$.targets[0].questions[2].requestedFlags',
    ]);
  });

  it('不正なUTF-8と不正なJSONを$のerrorへ分類する', () => {
    expect(errorsOf(parseExchangeExport(new Uint8Array([0x7b, 0xff, 0x7d])))).toEqual([{ path: '$', message: expect.any(String) }]);
    expect(errorsOf(parseExchangeExport('{'))).toEqual([{ path: '$', message: expect.any(String) }]);
    expect(errorsOf(parseExchangeExport('[]'))).toEqual([{ path: '$', message: expect.any(String) }]);
  });
});

describe('EligibilityTargetからexport targetへの写像', () => {
  const source = golden.targets[0]!;
  const eligibility: EligibilityTarget = {
    keywordId: source.keyword.id,
    metrics: source.metrics,
    reasons: source.reasons as EligibilityTarget['reasons'],
    flaggedQuestions: source.flaggedQuestions as EligibilityTarget['flaggedQuestions'],
  };
  const context = {
    keyword: { displayText: source.keyword.displayText, modelAnswer: source.keyword.modelAnswer },
    chapterContexts: [...source.chapterContexts].reverse(),
    questions: [...source.questions].reverse().map(({ requestedFlags: _flags, ...rest }) => rest),
  };

  it('keywordId・metrics・reasons・flaggedQuestionsを欠落なく写像し、requestedFlagsを導出して安定順に整える', () => {
    expect(toExchangeTarget(eligibility, context)).toEqual(source);
  });

  it('組み立てたexportはgolden fixtureと完全一致しtargetをkeyword ID順に整列する', () => {
    const second = golden.targets[1]!;
    const target2 = toExchangeTarget(
      {
        keywordId: second.keyword.id,
        metrics: second.metrics,
        reasons: second.reasons as EligibilityTarget['reasons'],
        flaggedQuestions: second.flaggedQuestions as EligibilityTarget['flaggedQuestions'],
      },
      {
        keyword: { displayText: second.keyword.displayText, modelAnswer: second.keyword.modelAnswer },
        chapterContexts: [],
        questions: second.questions.map(({ requestedFlags: _f, ...rest }) => rest),
      },
    );
    const built: QuestionExchangeExportV1 = buildExchangeExport(header, golden.filters, [
      target2,
      toExchangeTarget(eligibility, context),
    ]);
    expect(built).toEqual(golden);
  });

  it('keywordに属さないflaggedQuestionは写像できない', () => {
    expect(() => toExchangeTarget(eligibility, { ...context, questions: context.questions.slice(1) })).toThrow();
  });
});

describe('import schema v1', () => {
  it('create/updateの有効なoperationを読み込み、round tripで同じ値に戻る', () => {
    const value = validImport() as QuestionExchangeImportV1;
    expect(parseExchangeImport(JSON.stringify(value))).toEqual({ ok: true, value });
    expect(parseExchangeImport(serializeExchangeImport(value))).toEqual({ ok: true, value });
  });

  it('sourceRequestedFlagsの順序を変更せず保持する', () => {
    const value = validImport();
    const result = parseExchangeImport(JSON.stringify(value));
    if (!result.ok) throw new Error('invalid');
    expect((result.value.operations[1] as { sourceRequestedFlags: unknown }).sourceRequestedFlags).toEqual([
      'doubt',
      'explanation-request',
    ]);
  });

  it('createへのquestionId混入、updateのID/版欠落を拒否する', () => {
    const withId = validImport();
    withId.operations[0]!.questionId = Q1;
    expect(errorsOf(parseExchangeImport(JSON.stringify(withId))).map((e) => e.path)).toEqual(['$.operations[0].questionId']);

    const missing = validImport();
    delete missing.operations[1].questionId;
    delete missing.operations[1].expectedVersion;
    expect(errorsOf(parseExchangeImport(JSON.stringify(missing))).map((e) => e.path)).toEqual([
      '$.operations[1].questionId',
      '$.operations[1].expectedVersion',
    ]);
  });

  it('delete命令と未知kindを拒否する', () => {
    const value = validImport();
    value.operations.push({ kind: 'delete', keywordId: K1, questionId: Q1 }, { kind: 'merge' });
    expect(errorsOf(parseExchangeImport(JSON.stringify(value)))).toEqual([
      { path: '$.operations[2].kind', message: expect.stringContaining('削除') },
      { path: '$.operations[3].kind', message: expect.any(String) },
    ]);
  });

  it('question内のkeywordId混入、未知flag、schema版違反を拒否する', () => {
    const value = validImport();
    value.operations[0].question.keywordId = K1;
    value.operations[1].resolvedFlags = ['other'];
    value.schemaVersion = '1';
    expect(errorsOf(parseExchangeImport(JSON.stringify(value))).map((e) => e.path)).toEqual([
      '$.schemaVersion',
      '$.operations[0].question.keywordId',
      '$.operations[1].resolvedFlags[0]',
    ]);
  });
});

describe('createUpdateOperation', () => {
  it('ExportQuestion.requestedFlagsをsourceRequestedFlagsへ順序も含めて複製し、元配列と共有しない', () => {
    const exported = golden.targets[0]!.questions[0]! as QuestionExchangeExportV1['targets'][number]['questions'][number];
    const op = createUpdateOperation(K1, exported, draftQuestion, ['doubt']);
    expect(op).toEqual({
      kind: 'update',
      keywordId: K1,
      questionId: exported.questionId,
      expectedVersion: exported.expectedVersion,
      question: draftQuestion,
      sourceRequestedFlags: ['doubt', 'explanation-request'],
      resolvedFlags: ['doubt'],
    });
    expect(op.sourceRequestedFlags).not.toBe(exported.requestedFlags);
    expect(Object.isFrozen(op.sourceRequestedFlags)).toBe(true);
  });

  it('requestedFlagsの部分集合でないresolvedFlagsは作成できない', () => {
    const exported = golden.targets[0]!.questions[2]! as QuestionExchangeExportV1['targets'][number]['questions'][number];
    expect(() => createUpdateOperation(K1, exported, draftQuestion, ['explanation-request'])).toThrow();
  });
});
