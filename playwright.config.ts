import { defineConfig } from '@playwright/test';

const PORT = process.env.TEST_PORT || '3334';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: 'pnpm start',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
      PORT: PORT,
    },
  },
});
