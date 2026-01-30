// tests/integrations/sheets/toolkit.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createSheetsClient } from '../../../src/integrations/sheets/auth';
import { getValues } from '../../../src/integrations/sheets/toolkit';
import type { SheetRef } from '../../../src/integrations/sheets/types';

const TEST_SPREADSHEET_ID = '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';

// Skip if no credentials (CI environment)
const hasCredentials = existsSync('./secrets/google-secrets.json') && existsSync('./secrets/google-tokens.json');

describe.skipIf(!hasCredentials)('Sheets Toolkit (integration)', () => {
  let sheetRef: SheetRef;

  beforeAll(() => {
    const creds = JSON.parse(readFileSync('./secrets/google-secrets.json', 'utf-8'));
    const tokens = JSON.parse(readFileSync('./secrets/google-tokens.json', 'utf-8'));

    const client = createSheetsClient({
      clientId: creds.installed.client_id,
      clientSecret: creds.installed.client_secret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });

    sheetRef = {
      client,
      spreadsheetId: TEST_SPREADSHEET_ID,
      sheetName: 'bookantt_2025',
    };
  });

  describe('getValues', () => {
    it('should get column values (book titles from column E)', async () => {
      const values = await getValues(sheetRef, {
        axis: 'row',  // searching rows, so we get values from multiple rows in one column
        at: 4,        // column E (0-indexed = 4)
        range: [2, 10], // rows 3-11 (0-indexed)
      });

      expect(values.length).toBeGreaterThan(0);
      // First book should be "Meditation" based on our inspection
      expect(values[0]).toContain('Meditation');
    });

    it('should get row values (date headers from row 2)', async () => {
      const values = await getValues(sheetRef, {
        axis: 'col',  // searching columns, so we get values from multiple columns in one row
        at: 1,        // row 2 (0-indexed = 1)
        range: [9, 20], // columns J-U (0-indexed = 9-20)
      });

      expect(values.length).toBeGreaterThan(0);
      // Should have day numbers: 1, 2, 3, etc.
      expect(values[0]).toBe('1');
      expect(values[1]).toBe('2');
    });
  });
});
