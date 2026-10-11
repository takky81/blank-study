import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'question-list.component.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:51973', locale: 'ja-JP', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 51973 --strictPort',
    url: 'http://127.0.0.1:51973',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
