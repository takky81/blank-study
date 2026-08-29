/**
 * zip の読み書き。決定表「エクスポート」「インポートの単位」の入り口。
 * パスと本文の対応（zip.ts）を、実際の zip ファイルとやり取りする。
 */

import { zipSync, unzipSync } from 'fflate';

/**
 * 文字列とバイト列の変換。
 * TextEncoder が返す配列は実行環境によっては別物として扱われ、
 * zip の組み立てで中身をフォルダと取り違える。ここで作り直して揃える。
 */
function toBytes(text: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(text));
}

function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** 章の本文を zip にまとめる。 */
export function encodeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = toBytes(content);
  }
  return zipSync(entries, { level: 6 });
}

/**
 * zip を開いて中身を取り出す（決定表「インポートの単位」列5）。
 * 展開できない zip は読み込めないものとして扱う。
 */
export function decodeZip(bytes: Uint8Array): Record<string, string> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error('zip を読み込めませんでした');
  }

  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(entries)) {
    // フォルダそのものの項目は中身を持たない
    if (path.endsWith('/')) continue;
    files[path] = fromBytes(content);
  }
  return files;
}

/** zip のファイル名。教材名をそのまま使う（仕様書 §4.4）。 */
export function zipFileName(materialName: string): string {
  const name = materialName.replace(/[/\\:*?"<>|]/g, '_').trim() || '教材';
  return `${name}.zip`;
}
