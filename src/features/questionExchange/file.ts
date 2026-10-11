import type { EligibilityExportResult } from './api';
import { parseExchangeImport, serializeExchangeExport } from './schema';
import type { ExchangeParseResult, QuestionExchangeImportV1 } from './types';

export type SaveBlob = (fileName: string, blob: Blob) => void;

export type ExchangeDownloadResult = { kind: 'empty' } | { kind: 'downloaded'; fileName: string };

const JSON_MIME = 'application/json;charset=utf-8';

/** path区切り・制御文字を含まない `question-exchange-YYYYMMDDTHHMMSSZ.json`。 */
export function buildExchangeFileName(date: Date): string {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  return `question-exchange-${stamp}.json`;
}

/** transfer/download.tsと同じanchor方式でBlobを保存させる。 */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 対象0件ではdownloadせず、schema v1を検証済みUTF-8 JSONとして保存する。 */
export function downloadExchangeExport(
  result: EligibilityExportResult,
  deps: { save?: SaveBlob; now?: () => Date } = {},
): ExchangeDownloadResult {
  if (result.kind !== 'export') return { kind: 'empty' };
  const json = serializeExchangeExport(result.value);
  const blob = new Blob([new TextEncoder().encode(json)], { type: JSON_MIME });
  const fileName = buildExchangeFileName((deps.now ?? (() => new Date()))());
  (deps.save ?? saveBlob)(fileName, blob);
  return { kind: 'downloaded', fileName };
}

/** 選択fileを生bytesとして読む（UTF-8 decodeはcodecが厳格に行う）。 */
export async function readExchangeFileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('fileを読み込めません。'));
    reader.readAsArrayBuffer(file);
  });
}

/** 返却JSON fileを読み、invalid UTF-8/JSON/schemaを書込み前のpath付きerrorにする。 */
export async function readExchangeImportFile(file: Blob): Promise<ExchangeParseResult<QuestionExchangeImportV1>> {
  let bytes: Uint8Array;
  try {
    bytes = await readExchangeFileBytes(file);
  } catch {
    return { ok: false, errors: [{ path: '$', message: 'fileを読み込めません。' }] };
  }
  return parseExchangeImport(bytes);
}
