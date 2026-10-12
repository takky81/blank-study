import { describe, expect, it } from 'vitest';

import type { StructuredQuestion } from '../questions/types';
import { planImportPreview, type ImportPreviewSnapshot } from './preview';
import type { ImportOperation, QuestionExchangeImportV1, UpdateOperation } from './types';

const K1 = '11111111-1111-4111-8111-111111111111';
const K2 = '22222222-2222-4222-8222-222222222222';
const KX = '99999999-9999-4999-8999-999999999999';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Q2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const QX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const content = { questionText: '新しい問い', modelAnswer: '答え', choices: ['誤り'], explanation: null };
const current = (id: string, overrides: Partial<StructuredQuestion> = {}): StructuredQuestion => ({
  id, version: 3, updatedAt: '2026-10-01T00:00:00Z', ownerId: 'o', materialId: 'm', keywordId: K1,
  questionText: '古い問い', modelAnswer: '答え', choices: [], explanation: null, sortOrder: 0, isActive: true,
  doubtFlag: true, doubtNote: null, doubtReasons: [], explanationRequestFlag: false, ...overrides,
});
const create = (keywordId = K1): ImportOperation => ({ kind: 'create', keywordId, question: content });
const update = (questionId: string, overrides: Partial<UpdateOperation> = {}): UpdateOperation => ({
  kind: 'update', keywordId: K1, questionId, expectedVersion: 3, question: content,
  sourceRequestedFlags: ['doubt'], resolvedFlags: ['doubt'], ...overrides,
});
const file = (operations: ImportOperation[]): QuestionExchangeImportV1 => ({
  schemaVersion: 1, exchangeId: '33333333-3333-4333-8333-333333333333', exportedAt: '2026-10-11T00:00:00Z', operations,
});
const snapshot = (questions: StructuredQuestion[] = [current(Q1), current(Q2, { version: 5 })]): ImportPreviewSnapshot => ({
  questions: new Map(questions.map((q) => [q.id, q])),
  keywordIds: new Set([K1, K2]),
});

describe('planImportPreview', () => {
  it('createと版一致updateを変更前後付きで分類し保存可能にする', () => {
    const preview = planImportPreview(file([create(K2), update(Q1)]), snapshot());
    expect(preview).toEqual({
      items: [
        { kind: 'create', operationIndex: 0, keywordId: K2, draft: content },
        { kind: 'update', operationIndex: 1, keywordId: K1, before: current(Q1), after: content },
      ],
      canCommit: true,
    });
  });

  it('版不一致は現在内容・現在版と返却内容を持つstale競合にして保存不可にする', () => {
    const incoming = update(Q2);
    const preview = planImportPreview(file([create(), incoming]), snapshot());
    expect(preview.items[1]).toEqual({ kind: 'conflict', operationIndex: 1, current: current(Q2, { version: 5 }), incoming });
    expect(preview.canCommit).toBe(false);
  });

  it('未知keywordと未知questionは同じerror表現にして保存不可にする', () => {
    const preview = planImportPreview(file([create(KX), update(QX)]), snapshot());
    expect(preview.canCommit).toBe(false);
    expect(preview.items).toEqual([
      { kind: 'error', operationIndex: 0, path: '$.operations[0].keywordId', message: `keyword ID ${KX} は存在しません。` },
      { kind: 'error', operationIndex: 1, path: '$.operations[1].questionId', message: `設問ID ${QX} は存在しません。` },
    ]);
  });

  it('他ownerの参照はsnapshotに現れないため未知と同一の結果になる', () => {
    const unknown = planImportPreview(file([update(QX, { keywordId: KX })]), snapshot());
    const foreignHidden = planImportPreview(file([update(QX, { keywordId: KX })]), snapshot());
    expect(foreignHidden).toEqual(unknown);
  });

  it('無効化済み設問は未知として扱う', () => {
    const preview = planImportPreview(file([update(Q1)]), snapshot([current(Q1, { isActive: false })]));
    expect(preview.items).toEqual([
      { kind: 'error', operationIndex: 0, path: '$.operations[0].questionId', message: `設問ID ${Q1} は存在しません。` },
    ]);
  });

  it('現在立っていないflagの解除はerrorにする', () => {
    const preview = planImportPreview(file([update(Q1, {
      sourceRequestedFlags: ['doubt', 'explanation-request'], resolvedFlags: ['explanation-request'],
    })]), snapshot());
    expect(preview.items).toEqual([{
      kind: 'error', operationIndex: 0, path: '$.operations[0].resolvedFlags[0]',
      message: `設問ID ${Q1} のフラグ explanation-request は現在立っていないため解除できません。`,
    }]);
    expect(preview.canCommit).toBe(false);
  });

  it('内容規則違反はerror、operation0件は保存不可にする', () => {
    const bad = planImportPreview(file([{ kind: 'create', keywordId: K1, question: { ...content, questionText: ' ' } }]), snapshot());
    expect(bad.items).toEqual([
      { kind: 'error', operationIndex: 0, path: '$.operations[0].question.questionText', message: '設問文を入力してください。' },
    ]);
    expect(planImportPreview(file([]), snapshot())).toEqual({ items: [], canCommit: false });
  });
});
