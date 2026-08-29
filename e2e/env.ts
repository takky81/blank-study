import { readFileSync } from 'node:fs';

/** .env.local を読む。E2E はローカルの Supabase に対して走る。 */
function readEnvLocal(): Record<string, string> {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
}

const env = readEnvLocal();

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? '';

/** E2E で使うログイン情報。global-setup が存在を保証する。 */
export const TEST_USER = { email: 'e2e@example.test', password: 'e2epassword' };
