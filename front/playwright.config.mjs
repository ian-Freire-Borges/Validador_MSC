import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4217';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './dist/playwright-results',
  timeout: 45_000,
  use: { baseURL, browserName: 'chromium', headless: true },
  webServer: {
    command: 'npm run build && node tests/e2e/serve-build.mjs',
    url: baseURL,
    timeout: 120_000,
  },
});
