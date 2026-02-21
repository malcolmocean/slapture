// tests/fixtures/sheets-test-creds.ts
// Shared helper for loading Google Sheets credentials in tests.
// Checks personal creds (secrets/) first, then committable test creds (tests/fixtures/).
import { existsSync, readFileSync } from 'fs';

const SECRETS_PATH = './secrets/google-secrets.json';
const PERSONAL_TOKENS_PATH = './secrets/google-tokens.json';
const TEST_TOKENS_PATH = './tests/fixtures/google-test-tokens.json';

function getTokensPath(): string | null {
  if (existsSync(PERSONAL_TOKENS_PATH)) return PERSONAL_TOKENS_PATH;
  if (existsSync(TEST_TOKENS_PATH)) return TEST_TOKENS_PATH;
  return null;
}

export const tokensPath = getTokensPath();
export const hasCredentials = existsSync(SECRETS_PATH) && tokensPath !== null;

export function loadCredentials() {
  if (!hasCredentials || !tokensPath) {
    throw new Error('No Google Sheets credentials available');
  }
  const creds = JSON.parse(readFileSync(SECRETS_PATH, 'utf-8'));
  const tokens = JSON.parse(readFileSync(tokensPath, 'utf-8'));
  return {
    clientId: creds.installed.client_id as string,
    clientSecret: creds.installed.client_secret as string,
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
  };
}
