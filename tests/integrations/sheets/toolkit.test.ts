// tests/integrations/sheets/toolkit.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createSheetsClient } from '../../../src/integrations/sheets/auth';
import { getValues, lookup, setCellValue } from '../../../src/integrations/sheets/toolkit';
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

  describe('lookup', () => {
    it('should find row by exact match in column', async () => {
      // Find "No Bad Parts" in column E (title column)
      const result = await lookup(sheetRef, {
        axis: 'row',
        at: 4,  // column E
        value: 'No Bad Parts',
        match: 'exact',
        range: [2, 50],
      });

      expect(result.index).not.toBeNull();
      // "No Bad Parts" is row 14 (0-indexed = 13)
      expect(result.index).toBe(13);
    });

    it('should find column by exact match in row', async () => {
      // Find day "5" in row 2 (date header row)
      const result = await lookup(sheetRef, {
        axis: 'col',
        at: 1,  // row 2
        value: '5',
        match: 'exact',
        range: [9, 40],  // date columns start at J
      });

      expect(result.index).not.toBeNull();
      // Day 5 should be at column N (0-indexed = 13)
      expect(result.index).toBe(13);
    });

    it('should return null when not found', async () => {
      const result = await lookup(sheetRef, {
        axis: 'row',
        at: 4,
        value: 'Nonexistent Book Title XYZ',
        match: 'exact',
        range: [2, 50],
      });

      expect(result.index).toBeNull();
    });
  });

  describe('lookup with date match', () => {
    it('should find column by day-of-month number', async () => {
      // In bookantt, row 2 has day numbers: 1, 2, 3, etc.
      // Find column for day 15
      const result = await lookup(sheetRef, {
        axis: 'col',
        at: 1,  // row 2 (0-indexed)
        value: new Date(2025, 0, 15), // Jan 15, 2025
        match: 'date',
        range: [9, 40],
      });

      expect(result.index).not.toBeNull();
      // Day 15 should be at column X (J=9, so 9+14=23)
      expect(result.index).toBe(23);
    });

    it('should find row by date string in gwen_memories', async () => {
      const gwenSheet: SheetRef = { ...sheetRef, sheetName: 'gwen_memories' };

      // gwen_memories has dates like "May 23, 2025" in column A
      // Find the row for May 24, 2025
      const result = await lookup(gwenSheet, {
        axis: 'row',
        at: 0,  // column A
        value: new Date(2025, 4, 24), // May 24, 2025
        match: 'date',
        range: [2, 30],
      });

      expect(result.index).not.toBeNull();
      // May 24, 2025 is at row 3 (0-indexed)
      expect(result.index).toBe(3);
    });
  });

  describe('lookup with fuzzy match', () => {
    it('should use fuzzyMatcher callback to find best match', async () => {
      // Mock fuzzy matcher that finds "No Bad Parts" when given "bad parts"
      const mockFuzzyMatcher = async (candidates: string[], target: string): Promise<number | null> => {
        const lowerTarget = target.toLowerCase();
        for (let i = 0; i < candidates.length; i++) {
          if (candidates[i].toLowerCase().includes(lowerTarget)) {
            return i;
          }
        }
        return null;
      };

      const result = await lookup(sheetRef, {
        axis: 'row',
        at: 4,  // column E (title)
        value: 'bad parts',
        match: 'fuzzy',
        fuzzyMatcher: mockFuzzyMatcher,
        range: [2, 50],
      });

      expect(result.index).not.toBeNull();
      expect(result.matchedValue).toContain('No Bad Parts');
    });

    it('should throw if fuzzy match requested without matcher', async () => {
      await expect(
        lookup(sheetRef, {
          axis: 'row',
          at: 4,
          value: 'something',
          match: 'fuzzy',
          range: [2, 50],
        })
      ).rejects.toThrow('fuzzyMatcher callback required');
    });
  });

  describe('setCellValue', () => {
    it('should write value to specific cell', async () => {
      // Write to a test cell in bookantt (row 5, column J = row 4, col 9 in 0-indexed)
      // This is the "time read" cell for row 5, day 1
      await setCellValue(sheetRef, {
        row: 4,
        col: 9,
        value: '42',
      });

      // Read it back
      const values = await getValues(sheetRef, {
        axis: 'col',
        at: 4,
        range: [9, 9],
      });

      expect(values[0]).toBe('42');

      // Clean up: clear the cell
      await setCellValue(sheetRef, {
        row: 4,
        col: 9,
        value: '',
      });
    });
  });
});
