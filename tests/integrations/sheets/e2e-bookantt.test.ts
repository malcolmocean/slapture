import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createSheetsClient } from '../../../src/integrations/sheets/auth';
import { lookup, setCellValue, getValues } from '../../../src/integrations/sheets/toolkit';
import type { SheetRef } from '../../../src/integrations/sheets/types';

const TEST_SPREADSHEET_ID = '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';
const hasCredentials = existsSync('./secrets/google-secrets.json') && existsSync('./secrets/google-tokens.json');

describe.skipIf(!hasCredentials)('E2E: Bookantt', () => {
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
      sheetName: 'bookantt_2025',
    };
  });

  it('should log reading time by book title (fuzzy) and date', async () => {
    // Mock fuzzy matcher - in real usage this would be an LLM call
    const fuzzyMatcher = async (candidates: string[], target: string): Promise<number | null> => {
      const lowerTarget = target.toLowerCase();
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]?.toLowerCase() ?? '';
        // Simple substring match: candidate must contain the target
        if (candidate.includes(lowerTarget)) {
          return i;
        }
      }
      return null;
    };

    // Find "No Bad Parts" using fuzzy match with "bad parts"
    const bookResult = await lookup(sheet, {
      axis: 'row',
      at: 4,  // column E (title)
      value: 'bad parts',
      match: 'fuzzy',
      fuzzyMatcher,
      range: [2, 50],
    });

    expect(bookResult.index).not.toBeNull();
    expect(bookResult.matchedValue).toContain('No Bad Parts');

    const bookRow = bookResult.index!;

    // Find column for day 10
    const dateResult = await lookup(sheet, {
      axis: 'col',
      at: 1,  // row 2 (date header)
      value: new Date(2025, 0, 10),  // Jan 10
      match: 'date',
      range: [9, 40],
    });

    expect(dateResult.index).not.toBeNull();
    const dateCol = dateResult.index!;

    // Write reading time
    const testMinutes = '15';
    await setCellValue(sheet, {
      row: bookRow,
      col: dateCol,
      value: testMinutes,
    });

    // Verify
    const verifyValues = await getValues(sheet, {
      axis: 'col',
      at: bookRow,
      range: [dateCol, dateCol],
    });
    expect(verifyValues[0]).toBe(15); // Returns number with UNFORMATTED_VALUE

    // Cleanup
    await setCellValue(sheet, {
      row: bookRow,
      col: dateCol,
      value: '',
    });
  });

  it('should return null when book not found (no createIfMissing)', async () => {
    const fuzzyMatcher = async (): Promise<number | null> => null;

    const result = await lookup(sheet, {
      axis: 'row',
      at: 4,
      value: 'Completely Nonexistent Book XYZ123',
      match: 'fuzzy',
      fuzzyMatcher,
      range: [2, 50],
    });

    expect(result.index).toBeNull();
  });
});
