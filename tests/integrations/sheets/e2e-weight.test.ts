import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createSheetsClient } from '../../../src/integrations/sheets/auth';
import { appendRow, getValues, deleteRow } from '../../../src/integrations/sheets/toolkit';
import type { SheetRef } from '../../../src/integrations/sheets/types';

const TEST_SPREADSHEET_ID = '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';
const hasCredentials = existsSync('./secrets/google-secrets.json') && existsSync('./secrets/google-tokens.json');

describe.skipIf(!hasCredentials)('E2E: Weight Log', () => {
  let sheet: SheetRef;

  beforeAll(() => {
    const creds = JSON.parse(readFileSync('./secrets/google-secrets.json', 'utf-8'));
    const tokens = JSON.parse(readFileSync('./secrets/google-tokens.json', 'utf-8'));

    const client = createSheetsClient({
      clientId: creds.installed.client_id,
      clientSecret: creds.installed.client_secret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });

    sheet = {
      client,
      spreadsheetId: TEST_SPREADSHEET_ID,
      sheetName: 'weight',
    };
  });

  it('should log weight entry with auto-calculated lbs', async () => {
    const today = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const kgValue = 85.5;
    const lbsValue = Math.round(kgValue * 2.20462 * 10) / 10;

    // Append entry
    const { row } = await appendRow(sheet, {
      values: [today, kgValue, lbsValue, 'test entry - delete me'],
    });

    expect(row).toBeGreaterThan(0);

    // Verify it was added
    const dates = await getValues(sheet, { axis: 'row', at: 0, range: [row, row] });
    expect(dates[0]).toContain(today.split(',')[0]); // Month Day part

    // Cleanup
    await deleteRow(sheet, row);
  });
});
