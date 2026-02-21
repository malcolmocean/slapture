// tests/integrations/sheets/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSheetsClient, SheetsAuth } from '../../../src/integrations/sheets/auth';

describe('SheetsAuth', () => {
  it('should create authenticated sheets client from credentials and tokens', async () => {
    const auth: SheetsAuth = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    };

    const client = createSheetsClient(auth);

    // Should return a sheets client object
    expect(client).toBeDefined();
    expect(client.spreadsheets).toBeDefined();
  });
});
