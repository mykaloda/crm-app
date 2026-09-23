import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Browser e2e: starts the built API and web app against the database in DATABASE_URL.
// Build first: pnpm --filter @agentmatch/api build && pnpm --filter @agentmatch/web build
const chromium = process.env.PW_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    launchOptions: chromium ? { executablePath: chromium } : {},
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      env: { MATCHING_ENABLE_SCHEDULER: 'false' },
    },
    { command: 'npx next start -p 3000', url: 'http://localhost:3000', reuseExistingServer: true },
  ],
});
