// tests/integrations/sheets/toolkit.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createSheetsClient } from '../../../src/integrations/sheets/auth';
import { getValues, lookup, setCellValue, appendRow, deleteRow, getRecentActivity, insertRow, sheetsSerialToDate, getCellFormatTypes } from '../../../src/integrations/sheets/toolkit';
import type { SheetRef } from '../../../src/integrations/sheets/types';

const TEST_SPREADSHEET_ID = '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';

// Unit tests that don't require credentials
describe('sheetsSerialToDate', () => {
  it('converts Jan 1, 2025 serial to correct date (UTC)', () => {
    const date = sheetsSerialToDate(45658)!;
    // Serial dates are UTC-based
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(0); // January
    expect(date.getUTCDate()).toBe(1);
  });

  it('converts Jan 15, 2025 serial to correct date (UTC)', () => {
    const date = sheetsSerialToDate(45672)!;
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(0);
    expect(date.getUTCDate()).toBe(15);
  });

  it('converts Feb 1, 2025 serial to correct date (UTC)', () => {
    const date = sheetsSerialToDate(45689)!;
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(1); // February
    expect(date.getUTCDate()).toBe(1);
  });

  it('returns null for non-date-range numbers', () => {
    // Numbers too small or too large to be valid sheet dates
    expect(sheetsSerialToDate(100)).toBeNull();
    expect(sheetsSerialToDate(-1)).toBeNull();
  });
});

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
      // Values are now unformatted serial dates (numbers), not formatted strings
      // Jan 1, 2025 = 45658, Jan 2 = 45659, etc.
      expect(typeof values[0]).toBe('number');
      expect(values[0]).toBe(45658); // Jan 1, 2025
      expect(values[1]).toBe(45659); // Jan 2, 2025
    });

    it('should return unformatted values (date serials) by default', async () => {
      // Row 2 columns J onwards contain actual Date values formatted to show day-of-month
      // The underlying values are Google Sheets serial dates (days since Dec 30, 1899)
      const values = await getValues(sheetRef, {
        axis: 'col',
        at: 1,        // row 2 (0-indexed = 1)
        range: [9, 11], // columns J-L (first 3 date columns)
      });

      expect(values.length).toBe(3);
      // Should be serial date numbers, not formatted strings
      // Jan 1, 2025 = 45658, Jan 2 = 45659, Jan 3 = 45660
      expect(typeof values[0]).toBe('number');
      expect(values[0]).toBe(45658); // Jan 1, 2025
      expect(values[1]).toBe(45659); // Jan 2, 2025
      expect(values[2]).toBe(45660); // Jan 3, 2025
    });
  });

  describe('getCellFormatTypes', () => {
    it('should detect DATE format for date columns', async () => {
      const formats = await getCellFormatTypes(sheetRef, {
        axis: 'col',
        at: 1,        // row 2 (date header)
        range: [9, 11], // columns J-L
      });

      expect(formats.length).toBe(3);
      expect(formats[0]).toBe('DATE');
      expect(formats[1]).toBe('DATE');
      expect(formats[2]).toBe('DATE');
    });

    it('should detect non-DATE format for text/number columns', async () => {
      // Column E (book titles) should not be DATE
      const formats = await getCellFormatTypes(sheetRef, {
        axis: 'row',
        at: 4,        // column E
        range: [2, 5], // a few book rows
      });

      expect(formats.length).toBeGreaterThan(0);
      // Text columns typically have no explicit numberFormat, so they're 'OTHER'
      expect(formats.every(f => f !== 'DATE' && f !== 'DATE_TIME')).toBe(true);
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

    it('should find column by exact match in row (serial number)', async () => {
      // Find serial 45662 (Jan 5, 2025) in row 2 (date header row)
      // Now that we use UNFORMATTED_VALUE, dates are serial numbers
      const result = await lookup(sheetRef, {
        axis: 'col',
        at: 1,  // row 2
        value: 45662, // Jan 5, 2025 as serial
        match: 'exact',
        range: [9, 40],  // date columns start at J
      });

      expect(result.index).not.toBeNull();
      // Jan 5 should be at column N (0-indexed = 13)
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

      expect(values[0]).toBe(42); // Returns number since we use UNFORMATTED_VALUE

      // Clean up: clear the cell
      await setCellValue(sheetRef, {
        row: 4,
        col: 9,
        value: '',
      });
    });
  });

  describe('appendRow', () => {
    it('should append row to weight sheet', async () => {
      const weightSheet: SheetRef = { ...sheetRef, sheetName: 'weight' };

      // Count rows before
      const beforeValues = await getValues(weightSheet, {
        axis: 'row',
        at: 0,  // column A (dates)
        range: [0, 100],
      });
      const rowsBefore = beforeValues.filter(v => v !== null && v !== '').length;

      // Append a test row
      const testDate = 'TEST_DELETE_ME';
      await appendRow(weightSheet, {
        values: [testDate, '99.9', '220.2', 'test entry'],
      });

      // Count rows after
      const afterValues = await getValues(weightSheet, {
        axis: 'row',
        at: 0,
        range: [0, 100],
      });
      const rowsAfter = afterValues.filter(v => v !== null && v !== '').length;

      expect(rowsAfter).toBe(rowsBefore + 1);

      // Find and delete the test row (cleanup)
      const testRowIndex = afterValues.findIndex(v => v === testDate);
      if (testRowIndex !== -1) {
        await deleteRow(weightSheet, testRowIndex);
      }
    });
  });

  describe('getRecentActivity', () => {
    it('should find books with recent activity in bookantt', async () => {
      // First, add some test data: write "5" to row 14 ("No Bad Parts"), column J (day 1)
      await setCellValue(sheetRef, { row: 13, col: 9, value: '5' });

      const results = await getRecentActivity(sheetRef, {
        itemAxis: 'row',
        dateAt: 1,          // row 2 has date headers
        itemRange: [2, 30], // book rows
        dateRange: [9, 40], // date columns (J onwards)
        lookbackDays: 400,  // Jan 2025 dates need ~400 days lookback from Jan 2026
        labelAt: 4,         // column E has book titles
      });

      expect(results.length).toBeGreaterThan(0);

      // "No Bad Parts" should be in the results since we just added data
      const noBadParts = results.find(r => r.label?.includes('No Bad Parts'));
      expect(noBadParts).toBeDefined();

      // Clean up
      await setCellValue(sheetRef, { row: 13, col: 9, value: '' });
    });
  });

  describe('lookup with createIfMissing', () => {
    it('should create new row when book not found', async () => {
      const fuzzyMatcher = async (): Promise<number | null> => null;

      const result = await lookup(sheetRef, {
        axis: 'row',
        at: 4,
        value: 'TEST_NEW_BOOK_DELETE_ME',
        match: 'fuzzy',
        fuzzyMatcher,
        range: [2, 50],
        createIfMissing: {
          template: ['', '', 'b', 'n', 'TEST_NEW_BOOK_DELETE_ME', '', 'Test Author', 0],
          insertAt: 'end',
        },
      });

      expect(result.index).not.toBeNull();
      expect(result.created).toBe(true);

      // Verify the row was created
      const values = await getValues(sheetRef, {
        axis: 'col',
        at: result.index!,
        range: [0, 10],
      });
      expect(values[4]).toBe('TEST_NEW_BOOK_DELETE_ME');

      // Cleanup
      await deleteRow(sheetRef, result.index!);
    });
  });
});
