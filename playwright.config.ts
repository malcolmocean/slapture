import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.TEST_PORT || '4445'}`;

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: BASE_URL,
  },
  // Only start local server if not using external BASE_URL
  ...(process.env.BASE_URL ? {} : {
    webServer: {
      command: 'pnpm dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
        PORT: process.env.TEST_PORT || '4445',
        CALLBACK_BASE_URL: `http://localhost:${process.env.TEST_PORT || '4445'}`,
      },
    },
  }),
});
