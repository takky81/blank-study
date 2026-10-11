import { describe, expect, it, vi } from 'vitest';
import golden from './fixtures/question-exchange-v1.export.json';
import type { EligibilityFilter } from './types';
import { buildExchangeFileName, downloadExchangeExport, readExchangeImportFile, readExchangeFileBytes } from './file';
import { parseExchangeExport } from './schema';
import type { QuestionExchangeExportV1 } from './types';

const exported = golden as unknown as QuestionExchangeExportV1;
const now = () => new Date('2026-10-11T01:02:03.456Z');

describe('buildExchangeFileName', () => {
  it('区切り文字や制御文字を含まない安全なfilenameを作る', () => {
    const name = buildExchangeFileName(now());
    expect(name).toBe('question-exchange-20261011T010203Z.json');
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('downloadExchangeExport', () => {
  it('対象0件ではdownloadしない', () => {
    const save = vi.fn();
    expect(downloadExchangeExport({ kind: 'empty', filters: {} as EligibilityFilter }, { save, now })).toEqual({ kind: 'empty' });
    expect(save).not.toHaveBeenCalled();
  });

  it('UTF-8 JSON Blobとして保存し、artifactを再parseするとround tripする', async () => {
    const save = vi.fn<(fileName: string, blob: Blob) => void>();
    const result = downloadExchangeExport({ kind: 'export', value: exported }, { save, now });
    expect(result).toEqual({ kind: 'downloaded', fileName: 'question-exchange-20261011T010203Z.json' });
    const [fileName, blob] = save.mock.calls[0]!;
    expect(fileName).toBe('question-exchange-20261011T010203Z.json');
    expect(blob.type).toBe('application/json;charset=utf-8');
    const bytes = await readExchangeFileBytes(blob);
    const parsed = parseExchangeExport(bytes);
    expect(parsed).toEqual({ ok: true, value: exported });
  });

  it('既定のsaveはanchor downloadでobject URLを解放する', () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadExchangeExport({ kind: 'export', value: exported }, { now });
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });
});

describe('readExchangeImportFile', () => {
  it('不正なUTF-8はpath付きerrorになる', async () => {
    const result = await readExchangeImportFile(new Blob([new Uint8Array([0xff, 0xfe, 0x7b])]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('$');
  });

  it('壊れたJSONはpath付きerrorになりimportへ進まない', async () => {
    const result = await readExchangeImportFile(new Blob(['{"schemaVersion":']));
    expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ path: '$' })] });
  });

  it('schema違反はfield pathを返す', async () => {
    const result = await readExchangeImportFile(new Blob([JSON.stringify({ schemaVersion: 1 })]));
    expect(result.ok).toBe(false);
  });
});
