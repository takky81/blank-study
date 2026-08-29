import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio, relativeLuminance, readTokens } from './contrast';

/**
 * 決定表「表示設定と共通の振る舞い」列18。
 * 配色は src/index.css の変数だけで決まるので、そこを直接読んで確かめる。
 */
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const themes = {
  ライト: readTokens(css, ':root'),
  ダーク: readTokens(css, '.dark'),
};

/** 変数の取り違えに気づけるよう、名前が無いことは失敗として扱う。 */
function color(tokens: Record<string, string>, name: string): string {
  const found = tokens[name];
  if (found === undefined) throw new Error(`--c-${name} が定義されていません`);
  return found;
}

/** 文字と地の組み。4.5:1 以上（WCAG AA の本文）を求める。 */
const TEXT_PAIRS: [string, string][] = [
  ['ink', 'paper'],
  ['ink', 'panel'],
  ['ink', 'subtle'],
  ['ink', 'accent-panel'],
  ['ink', 'hover'],
  ['ink-soft', 'panel'],
  ['ink-soft', 'subtle'],
  ['ink-soft', 'hover'],
  ['muted', 'panel'],
  ['muted', 'paper'],
  ['muted', 'subtle'],
  ['link', 'paper'],
  ['link', 'panel'],
  ['warn', 'panel'],
  ['warn', 'warn-panel'],
  // 主ボタンは地が ink、文字が paper
  ['paper', 'ink'],
  ['paper', 'ink-hover'],
  // 出題中の空欄・伏せた語・誤答の位置・記述のハイライト
  ['ink', 'blank'],
  ['ink', 'kw'],
  ['ink-soft', 'mask'],
  ['ink', 'wrong'],
];

/** 部品の輪郭。3:1 以上（WCAG AA の非文字）を求める。 */
const EDGE_PAIRS: [string, string][] = [
  ['ink', 'panel'],
  ['ink', 'paper'],
  ['edge', 'panel'],
  ['edge', 'paper'],
  ['blank-edge', 'panel'],
  ['mask-edge', 'panel'],
  ['wrong-edge', 'panel'],
];

describe('配色のコントラスト比', () => {
  for (const [name, tokens] of Object.entries(themes)) {
    describe(name, () => {
      it('列18 文字と地は 4.5:1 以上ある', () => {
        for (const [fg, bg] of TEXT_PAIRS) {
          const ratio = contrastRatio(color(tokens, fg), color(tokens, bg));
          expect(`${fg} on ${bg}: ${ratio.toFixed(2)}`).toBe(
            `${fg} on ${bg}: ${Math.max(ratio, 4.5).toFixed(2)}`,
          );
        }
      });

      it('列18 部品の輪郭は 3:1 以上ある', () => {
        for (const [fg, bg] of EDGE_PAIRS) {
          const ratio = contrastRatio(color(tokens, fg), color(tokens, bg));
          expect(`${fg} / ${bg}: ${ratio.toFixed(2)}`).toBe(
            `${fg} / ${bg}: ${Math.max(ratio, 3).toFixed(2)}`,
          );
        }
      });

      it('列19 主ボタン・白抜きボタンのホバー・背景 の順に地が濃い', () => {
        const main = relativeLuminance(color(tokens, 'ink'));
        const hover = relativeLuminance(color(tokens, 'hover'));
        const paper = relativeLuminance(color(tokens, 'paper'));

        // ダークでは明暗が入れ替わるので、濃さの向きも入れ替える
        const [darkest, middle, lightest] =
          name === 'ライト' ? [main, hover, paper] : [paper, hover, main];
        expect(darkest).toBeLessThan(middle);
        expect(middle).toBeLessThan(lightest);
      });
    });
  }
});

describe('コントラスト比の計算', () => {
  it('黒と白は 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('同じ色は 1:1', () => {
    expect(contrastRatio('#3366cc', '#3366cc')).toBeCloseTo(1, 5);
  });

  it('順番を入れ替えても同じ値になる', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBeCloseTo(contrastRatio('#fedcba', '#123456'), 5);
  });

  it('3桁の指定も読める', () => {
    expect(contrastRatio('#fff', '#000000')).toBeCloseTo(21, 5);
  });
});
