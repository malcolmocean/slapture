# Google Sheets Toolkit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an axis-agnostic Google Sheets toolkit for routing captures to spreadsheets, supporting cell lookup, date-based operations, and fuzzy matching.

**Architecture:** The toolkit provides low-level primitives (`lookup`, `getValues`, `setCellValue`, `appendRow`, `getRecentActivity`) that are axis-agnostic (rows and columns are interchangeable). Higher-level operations (bookantt time logging, gwen memories, weight tracking) compose these primitives. Fuzzy matching is delegated to a callback, keeping the toolkit LLM-agnostic.

**Tech Stack:** TypeScript, googleapis, vitest for testing

**Test Spreadsheet:** `1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o` (SLAPTURE_TESTS)
- `bookantt_2025`: Books in rows (col E = title, col G = author), dates in columns (row 2 = day numbers starting col J)
- `gwen_memories`: Dates in rows (col A), memories in columns (cols D, E, ...)
- `weight`: Dates in rows (col A), weight in col B (kg), col C (lbs)

---

## Task 1: Auth Module

**Files:**
- Create: `src/integrations/sheets/auth.ts`
- Create: `tests/integrations/sheets/auth.test.ts`

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integrations/sheets/auth.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```typescript
// src/integrations/sheets/auth.ts
import { google, sheets_v4 } from 'googleapis';

export interface SheetsAuth {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}

export function createSheetsClient(auth: SheetsAuth): sheets_v4.Sheets {
  const oauth2Client = new google.auth.OAuth2(
    auth.clientId,
    auth.clientSecret
  );

  oauth2Client.setCredentials({
    access_token: auth.accessToken,
    refresh_token: auth.refreshToken,
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integrations/sheets/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/sheets/auth.ts tests/integrations/sheets/auth.test.ts
git commit -m "feat(sheets): add auth module for Google Sheets client"
```

---

## Task 2: Core Types

**Files:**
- Create: `src/integrations/sheets/types.ts`

**Step 1: Write the types file**

```typescript
// src/integrations/sheets/types.ts
import { sheets_v4 } from 'googleapis';

export type Axis = 'row' | 'col';

export interface SheetRef {
  client: sheets_v4.Sheets;
  spreadsheetId: string;
  sheetName: string;
}

export interface LookupConfig {
  /** Which axis to search along ('row' = find row index, 'col' = find column index) */
  axis: Axis;
  /** Fixed index on the other axis (e.g., column 5 when searching rows) */
  at: number;
  /** Value to search for */
  value: unknown;
  /** Match strategy */
  match?: 'exact' | 'fuzzy' | 'date';
  /** Custom fuzzy matcher - receives candidates and target, returns matching index or null */
  fuzzyMatcher?: (candidates: string[], target: string) => Promise<number | null>;
  /** Range to search within [start, end] inclusive. Defaults to full range. */
  range?: [number, number];
}

export interface LookupResult {
  /** The found index (0-based), or null if not found */
  index: number | null;
  /** The matched value (for debugging/logging) */
  matchedValue?: unknown;
}

export interface CreateIfMissingConfig {
  /** Template row/column to insert. Use null for empty cells. */
  template: unknown[];
  /** Where to insert: 'end' appends, number inserts at that index */
  insertAt?: 'end' | number;
}

export interface GetValuesConfig {
  axis: Axis;
  /** Fixed index (row number if axis='col', column number if axis='row') */
  at: number;
  /** Range [start, end] inclusive. Defaults to reasonable bounds. */
  range?: [number, number];
}

export interface RecentActivityConfig {
  /** Axis where items live (e.g., 'row' for bookantt books) */
  itemAxis: Axis;
  /** Row/col index where date headers are */
  dateAt: number;
  /** Range of item indices to scan */
  itemRange: [number, number];
  /** Range of date indices to scan */
  dateRange: [number, number];
  /** How many days back to look */
  lookbackDays: number;
}

export interface RecentActivityResult {
  /** Item index (row or column depending on itemAxis) */
  index: number;
  /** Most recent date with activity */
  lastActiveDate: Date;
  /** The label/name of this item (from a label column/row if provided) */
  label?: string;
}
```

**Step 2: Commit**

```bash
git add src/integrations/sheets/types.ts
git commit -m "feat(sheets): add core types for axis-agnostic toolkit"
```

---

## Task 3: getValues Function

**Files:**
- Create: `src/integrations/sheets/toolkit.ts`
- Create: `tests/integrations/sheets/toolkit.test.ts`

This test hits the real test spreadsheet. We'll use a helper to create the client from local secrets.

**Step 1: Write test helper and failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: FAIL with "Cannot find module" or "getValues is not a function"

**Step 3: Write minimal implementation**

```typescript
// src/integrations/sheets/toolkit.ts
import type { SheetRef, GetValuesConfig } from './types.js';

/**
 * Convert 0-based column index to A1 notation letter(s).
 * 0 -> A, 25 -> Z, 26 -> AA, etc.
 */
export function colIndexToLetter(index: number): string {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Get values along an axis.
 *
 * - axis='row': Get values from multiple rows in a single column (at=column index)
 * - axis='col': Get values from multiple columns in a single row (at=row index)
 */
export async function getValues(
  sheet: SheetRef,
  config: GetValuesConfig
): Promise<unknown[]> {
  const { axis, at, range } = config;
  const [start, end] = range ?? [0, 999];

  let rangeNotation: string;

  if (axis === 'row') {
    // Get values from column `at`, rows start to end
    const col = colIndexToLetter(at);
    rangeNotation = `'${sheet.sheetName}'!${col}${start + 1}:${col}${end + 1}`;
  } else {
    // Get values from row `at`, columns start to end
    const startCol = colIndexToLetter(start);
    const endCol = colIndexToLetter(end);
    rangeNotation = `'${sheet.sheetName}'!${startCol}${at + 1}:${endCol}${at + 1}`;
  }

  const response = await sheet.client.spreadsheets.values.get({
    spreadsheetId: sheet.spreadsheetId,
    range: rangeNotation,
  });

  const values = response.data.values;
  if (!values || values.length === 0) {
    return [];
  }

  // For row axis, values come as [[v1], [v2], ...] - flatten
  // For col axis, values come as [[v1, v2, ...]] - take first array
  if (axis === 'row') {
    return values.map(row => row[0] ?? null);
  } else {
    return values[0] ?? [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/sheets/toolkit.ts tests/integrations/sheets/toolkit.test.ts
git commit -m "feat(sheets): add getValues function for axis-agnostic value retrieval"
```

---

## Task 4: lookup Function (Exact Match)

**Files:**
- Modify: `src/integrations/sheets/toolkit.ts`
- Modify: `tests/integrations/sheets/toolkit.test.ts`

**Step 1: Write failing test**

Add to `tests/integrations/sheets/toolkit.test.ts`:

```typescript
import { getValues, lookup } from '../../../src/integrations/sheets/toolkit';

// ... inside the describe block ...

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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: FAIL with "lookup is not a function"

**Step 3: Write implementation**

Add to `src/integrations/sheets/toolkit.ts`:

```typescript
import type { SheetRef, GetValuesConfig, LookupConfig, LookupResult } from './types.js';

/**
 * Find an index along an axis by matching a value.
 *
 * - axis='row': Find which row contains `value` in column `at`
 * - axis='col': Find which column contains `value` in row `at`
 */
export async function lookup(
  sheet: SheetRef,
  config: LookupConfig
): Promise<LookupResult> {
  const { axis, at, value, match = 'exact', fuzzyMatcher, range } = config;

  const values = await getValues(sheet, { axis, at, range });

  const [startOffset] = range ?? [0, 999];

  if (match === 'exact') {
    const stringValue = String(value);
    for (let i = 0; i < values.length; i++) {
      const cellValue = values[i];
      // Check both exact match and "starts with" for truncated values
      if (cellValue !== null && cellValue !== undefined) {
        const cellStr = String(cellValue);
        if (cellStr === stringValue || cellStr.startsWith(stringValue) || stringValue.startsWith(cellStr)) {
          return { index: startOffset + i, matchedValue: cellValue };
        }
      }
    }
    return { index: null };
  }

  if (match === 'fuzzy') {
    if (!fuzzyMatcher) {
      throw new Error('fuzzyMatcher callback required for fuzzy match');
    }
    const stringValues = values.map(v => String(v ?? ''));
    const matchedLocalIndex = await fuzzyMatcher(stringValues, String(value));
    if (matchedLocalIndex !== null) {
      return { index: startOffset + matchedLocalIndex, matchedValue: values[matchedLocalIndex] };
    }
    return { index: null };
  }

  if (match === 'date') {
    // TODO: Implement in Task 5
    throw new Error('Date matching not yet implemented');
  }

  return { index: null };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/sheets/toolkit.ts tests/integrations/sheets/toolkit.test.ts
git commit -m "feat(sheets): add lookup function with exact matching"
```

---

## Task 5: lookup Function (Date Match)

**Files:**
- Modify: `src/integrations/sheets/toolkit.ts`
- Modify: `tests/integrations/sheets/toolkit.test.ts`

Date matching needs to handle the bookantt format where dates are stored as day-of-month numbers (1-31) in row 2, with the month context coming from the sheet name or a merged header cell. For now, we'll implement a simpler approach: match against actual Date values or day-of-month numbers.

**Step 1: Write failing test**

Add to tests:

```typescript
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

    // gwen_memories has dates like "May 23, 2024" in column A
    // Find the row for May 24, 2024
    const result = await lookup(gwenSheet, {
      axis: 'row',
      at: 0,  // column A
      value: new Date(2024, 4, 24), // May 24, 2024
      match: 'date',
      range: [2, 30],
    });

    expect(result.index).not.toBeNull();
    // May 24 should be row 4 (0-indexed = 3)
    expect(result.index).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: FAIL with "Date matching not yet implemented"

**Step 3: Write implementation**

Update the `lookup` function's date match branch:

```typescript
if (match === 'date') {
  const targetDate = value instanceof Date ? value : new Date(String(value));
  const targetDay = targetDate.getDate();
  const targetMonth = targetDate.getMonth();
  const targetYear = targetDate.getFullYear();

  for (let i = 0; i < values.length; i++) {
    const cellValue = values[i];
    if (cellValue === null || cellValue === undefined || cellValue === '') continue;

    const cellStr = String(cellValue).trim();

    // Try parsing as day-of-month number (bookantt format)
    const dayNum = parseInt(cellStr, 10);
    if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31 && dayNum === targetDay) {
      return { index: startOffset + i, matchedValue: cellValue };
    }

    // Try parsing as full date string (gwen_memories format: "May 23, 2024")
    const parsedDate = new Date(cellStr);
    if (!isNaN(parsedDate.getTime())) {
      if (
        parsedDate.getDate() === targetDay &&
        parsedDate.getMonth() === targetMonth &&
        parsedDate.getFullYear() === targetYear
      ) {
        return { index: startOffset + i, matchedValue: cellValue };
      }
    }
  }

  return { index: null };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/sheets/toolkit.ts tests/integrations/sheets/toolkit.test.ts
git commit -m "feat(sheets): add date matching to lookup function"
```

---

## Task 6: lookup Function (Fuzzy Match)

**Files:**
- Modify: `tests/integrations/sheets/toolkit.test.ts`

Fuzzy matching delegates to a callback. We test that the callback interface works correctly.

**Step 1: Write test**

```typescript
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
```

**Step 2: Run tests**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS (fuzzy implementation already done in Task 4)

**Step 3: Commit**

```bash
git add tests/integrations/sheets/toolkit.test.ts
git commit -m "test(sheets): add fuzzy match tests for lookup"
```

---

## Task 7: setCellValue Function

**Files:**
- Modify: `src/integrations/sheets/toolkit.ts`
- Modify: `tests/integrations/sheets/toolkit.test.ts`

**Step 1: Write failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: FAIL with "setCellValue is not a function"

**Step 3: Write implementation**

Add to `src/integrations/sheets/toolkit.ts`:

```typescript
export interface SetCellConfig {
  row: number;  // 0-indexed
  col: number;  // 0-indexed
  value: unknown;
}

/**
 * Set the value of a specific cell.
 */
export async function setCellValue(
  sheet: SheetRef,
  config: SetCellConfig
): Promise<void> {
  const { row, col, value } = config;
  const colLetter = colIndexToLetter(col);
  const range = `'${sheet.sheetName}'!${colLetter}${row + 1}`;

  await sheet.client.spreadsheets.values.update({
    spreadsheetId: sheet.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[value]],
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/sheets/toolkit.ts tests/integrations/sheets/toolkit.test.ts
git commit -m "feat(sheets): add setCellValue function"
```

---

## Task 8: appendRow Function

**Files:**
- Modify: `src/integrations/sheets/toolkit.ts`
- Modify: `tests/integrations/sheets/toolkit.test.ts`

**Step 1: Write failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: FAIL with "appendRow is not a function"

**Step 3: Write implementation**

Add to `src/integrations/sheets/toolkit.ts`:

```typescript
export interface AppendRowConfig {
  values: unknown[];
}

/**
 * Append a row to the end of the sheet's data.
 */
export async function appendRow(
  sheet: SheetRef,
  config: AppendRowConfig
): Promise<{ row: number }> {
  const { values } = config;

  const response = await sheet.client.spreadsheets.values.append({
    spreadsheetId: sheet.spreadsheetId,
    range: `'${sheet.sheetName}'!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [values],
    },
  });

  // Parse the updated range to get the row number
  const updatedRange = response.data.updates?.updatedRange ?? '';
  const match = updatedRange.match(/!A(\d+)/);
  const rowNumber = match ? parseInt(match[1], 10) - 1 : -1;

  return { row: rowNumber };
}

/**
 * Delete a row by index.
 */
export async function deleteRow(
  sheet: SheetRef,
  rowIndex: number
): Promise<void> {
  // First, get the sheet ID (not the spreadsheet ID)
  const meta = await sheet.client.spreadsheets.get({
    spreadsheetId: sheet.spreadsheetId,
  });

  const sheetMeta = meta.data.sheets?.find(
    s => s.properties?.title === sheet.sheetName
  );
  const sheetId = sheetMeta?.properties?.sheetId;

  if (sheetId === undefined) {
    throw new Error(`Sheet "${sheet.sheetName}" not found`);
  }

  await sheet.client.spreadsheets.batchUpdate({
    spreadsheetId: sheet.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/sheets/toolkit.ts tests/integrations/sheets/toolkit.test.ts
git commit -m "feat(sheets): add appendRow and deleteRow functions"
```

---

## Task 9: getRecentActivity Function

**Files:**
- Modify: `src/integrations/sheets/toolkit.ts`
- Modify: `tests/integrations/sheets/toolkit.test.ts`

**Step 1: Write failing test**

```typescript
describe('getRecentActivity', () => {
  it('should find books with recent activity in bookantt', async () => {
    // First, add some test data: write "5" to row 14 ("No Bad Parts"), column J (day 1)
    await setCellValue(sheetRef, { row: 13, col: 9, value: '5' });

    const results = await getRecentActivity(sheetRef, {
      itemAxis: 'row',
      dateAt: 1,          // row 2 has date headers
      itemRange: [2, 30], // book rows
      dateRange: [9, 40], // date columns (J onwards)
      lookbackDays: 31,   // all of January
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: FAIL with "getRecentActivity is not a function"

**Step 3: Write implementation**

Add to `src/integrations/sheets/toolkit.ts`:

```typescript
export interface RecentActivityConfig {
  itemAxis: Axis;
  dateAt: number;
  itemRange: [number, number];
  dateRange: [number, number];
  lookbackDays: number;
  /** Optional: index of label row/column for items */
  labelAt?: number;
}

export interface RecentActivityResult {
  index: number;
  lastActiveDate: Date | null;
  lastActiveIndex: number | null;
  label?: string;
}

/**
 * Find items (rows or columns) with recent activity.
 *
 * Scans the item range and for each item, checks the date range for non-empty values.
 * Returns items that have activity, sorted by most recent first.
 */
export async function getRecentActivity(
  sheet: SheetRef,
  config: RecentActivityConfig
): Promise<RecentActivityResult[]> {
  const { itemAxis, dateAt, itemRange, dateRange, lookbackDays, labelAt } = config;
  const [itemStart, itemEnd] = itemRange;
  const [dateStart, dateEnd] = dateRange;

  // Get date headers to know what dates we're looking at
  const dateHeaders = await getValues(sheet, {
    axis: itemAxis === 'row' ? 'col' : 'row',
    at: dateAt,
    range: dateRange,
  });

  // Get labels if requested
  let labels: unknown[] = [];
  if (labelAt !== undefined) {
    labels = await getValues(sheet, {
      axis: itemAxis,
      at: labelAt,
      range: itemRange,
    });
  }

  const results: RecentActivityResult[] = [];
  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  // For each item, scan across the date range
  for (let itemIdx = itemStart; itemIdx <= itemEnd; itemIdx++) {
    const values = await getValues(sheet, {
      axis: itemAxis === 'row' ? 'col' : 'row',
      at: itemIdx,
      range: dateRange,
    });

    let lastActiveIndex: number | null = null;
    let lastActiveDate: Date | null = null;

    // Scan backwards to find most recent activity
    for (let i = values.length - 1; i >= 0; i--) {
      const val = values[i];
      if (val !== null && val !== undefined && val !== '' && val !== '0') {
        // Parse the date header to get actual date
        const dateHeader = dateHeaders[i];
        const dayNum = parseInt(String(dateHeader), 10);

        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
          // Assume current month/year for day-of-month format
          // This is a simplification; real implementation might need month context
          const date = new Date(today.getFullYear(), today.getMonth(), dayNum);
          if (date > today) {
            // Day is in the future this month, must be last month
            date.setMonth(date.getMonth() - 1);
          }

          if (date >= cutoffDate) {
            lastActiveIndex = dateStart + i;
            lastActiveDate = date;
            break;
          }
        }
      }
    }

    if (lastActiveDate !== null) {
      results.push({
        index: itemIdx,
        lastActiveDate,
        lastActiveIndex,
        label: labels[itemIdx - itemStart] !== undefined ? String(labels[itemIdx - itemStart]) : undefined,
      });
    }
  }

  // Sort by most recent first
  results.sort((a, b) => {
    if (!a.lastActiveDate || !b.lastActiveDate) return 0;
    return b.lastActiveDate.getTime() - a.lastActiveDate.getTime();
  });

  return results;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/sheets/toolkit.ts tests/integrations/sheets/toolkit.test.ts
git commit -m "feat(sheets): add getRecentActivity for finding items with recent data"
```

---

## Task 10: Index Barrel File

**Files:**
- Create: `src/integrations/sheets/index.ts`

**Step 1: Create barrel file**

```typescript
// src/integrations/sheets/index.ts
export * from './auth.js';
export * from './types.js';
export * from './toolkit.js';
```

**Step 2: Commit**

```bash
git add src/integrations/sheets/index.ts
git commit -m "feat(sheets): add index barrel file"
```

---

## Task 11: Integration with Routes (Registration)

**Files:**
- Modify: `src/integrations/registry.ts`

**Step 1: Add sheets integration to registry**

```typescript
// Add to INTEGRATIONS array:
{
  id: 'sheets',
  name: 'Google Sheets',
  purpose: 'Capture data to Google Sheets - supports cell updates, row appends, and 2D lookups with fuzzy matching',
  authType: 'oauth',
},
```

**Step 2: Run existing tests to ensure no regression**

Run: `pnpm vitest run tests/integrations/registry.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/integrations/registry.ts
git commit -m "feat(sheets): register Google Sheets integration"
```

---

## Task 12: End-to-End Test - Weight Log (Simplest)

**Files:**
- Create: `tests/integrations/sheets/e2e-weight.test.ts`

This tests the simplest flow: append a row with date and weight.

**Step 1: Write test**

```typescript
// tests/integrations/sheets/e2e-weight.test.ts
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
```

**Step 2: Run test**

Run: `pnpm vitest run tests/integrations/sheets/e2e-weight.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integrations/sheets/e2e-weight.test.ts
git commit -m "test(sheets): add E2E test for weight log append"
```

---

## Task 13: End-to-End Test - Gwen Memories (Append to Date Row)

**Files:**
- Create: `tests/integrations/sheets/e2e-gwen.test.ts`

**Step 1: Write test**

```typescript
// tests/integrations/sheets/e2e-gwen.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createSheetsClient } from '../../../src/integrations/sheets/auth';
import { lookup, getValues, setCellValue } from '../../../src/integrations/sheets/toolkit';
import type { SheetRef } from '../../../src/integrations/sheets/types';

const TEST_SPREADSHEET_ID = '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';
const hasCredentials = existsSync('./secrets/google-secrets.json') && existsSync('./secrets/google-tokens.json');

describe.skipIf(!hasCredentials)('E2E: Gwen Memories', () => {
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
      sheetName: 'gwen_memories',
    };
  });

  it('should append memory to existing date row', async () => {
    // Find the row for May 25, 2024 (which exists but has empty memories)
    const targetDate = new Date(2024, 4, 25);

    const rowResult = await lookup(sheet, {
      axis: 'row',
      at: 0,  // column A has dates
      value: targetDate,
      match: 'date',
      range: [2, 100],
    });

    expect(rowResult.index).not.toBeNull();
    const rowIndex = rowResult.index!;

    // Get existing memories to find first empty column
    const memories = await getValues(sheet, {
      axis: 'col',
      at: rowIndex,
      range: [3, 10],  // columns D onwards (memory columns)
    });

    // Find first empty slot
    let emptyColIndex = 3; // Start at column D
    for (let i = 0; i < memories.length; i++) {
      if (!memories[i] || memories[i] === '') {
        emptyColIndex = 3 + i;
        break;
      }
    }

    // Write test memory
    const testMemory = 'TEST_MEMORY_DELETE_ME';
    await setCellValue(sheet, {
      row: rowIndex,
      col: emptyColIndex,
      value: testMemory,
    });

    // Verify
    const verifyValues = await getValues(sheet, {
      axis: 'col',
      at: rowIndex,
      range: [emptyColIndex, emptyColIndex],
    });
    expect(verifyValues[0]).toBe(testMemory);

    // Cleanup
    await setCellValue(sheet, {
      row: rowIndex,
      col: emptyColIndex,
      value: '',
    });
  });
});
```

**Step 2: Run test**

Run: `pnpm vitest run tests/integrations/sheets/e2e-gwen.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integrations/sheets/e2e-gwen.test.ts
git commit -m "test(sheets): add E2E test for gwen memories append-to-date-row"
```

---

## Task 14: End-to-End Test - Bookantt (Cell Lookup)

**Files:**
- Create: `tests/integrations/sheets/e2e-bookantt.test.ts`

**Step 1: Write test**

```typescript
// tests/integrations/sheets/e2e-bookantt.test.ts
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
        if (candidate.includes(lowerTarget) || lowerTarget.includes(candidate.split(' ')[0])) {
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
    expect(verifyValues[0]).toBe(testMinutes);

    // Cleanup
    await setCellValue(sheet, {
      row: bookRow,
      col: dateCol,
      value: '',
    });
  });

  it('should create new book row when not found (createIfMissing)', async () => {
    // This tests the createIfMissing flow
    // For now, we'll manually test by trying to find a nonexistent book
    const fuzzyMatcher = async (candidates: string[], target: string): Promise<number | null> => {
      return null; // Always returns not found
    };

    const result = await lookup(sheet, {
      axis: 'row',
      at: 4,
      value: 'Completely Nonexistent Book XYZ123',
      match: 'fuzzy',
      fuzzyMatcher,
      range: [2, 50],
    });

    expect(result.index).toBeNull();

    // TODO: When createIfMissing is implemented, test that flow here
  });
});
```

**Step 2: Run test**

Run: `pnpm vitest run tests/integrations/sheets/e2e-bookantt.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integrations/sheets/e2e-bookantt.test.ts
git commit -m "test(sheets): add E2E test for bookantt cell lookup"
```

---

## Task 15: Add createIfMissing to lookup

**Files:**
- Modify: `src/integrations/sheets/toolkit.ts`
- Modify: `src/integrations/sheets/types.ts`
- Modify: `tests/integrations/sheets/toolkit.test.ts`

**Step 1: Update types**

Add to `LookupConfig` in types.ts:

```typescript
/** If value not found, create a new row/column with this template */
createIfMissing?: {
  template: unknown[];
  /** Where to insert. 'end' appends after last non-empty. number inserts at that index. */
  insertAt?: 'end' | number;
};
```

**Step 2: Write failing test**

```typescript
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
```

**Step 3: Update LookupResult type**

```typescript
export interface LookupResult {
  index: number | null;
  matchedValue?: unknown;
  /** True if this index was just created via createIfMissing */
  created?: boolean;
}
```

**Step 4: Implement createIfMissing in lookup function**

At the end of the lookup function, before `return { index: null }`:

```typescript
// If not found and createIfMissing specified, create the row/column
if (config.createIfMissing) {
  const { template, insertAt = 'end' } = config.createIfMissing;

  if (axis === 'row') {
    // Find where to insert
    let insertIndex: number;
    if (insertAt === 'end') {
      // Find last non-empty row in the range
      const [start, end] = range ?? [0, 999];
      const vals = await getValues(sheet, { axis, at, range: [start, end] });
      let lastNonEmpty = start;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] !== null && vals[i] !== undefined && vals[i] !== '') {
          lastNonEmpty = start + i;
        }
      }
      insertIndex = lastNonEmpty + 1;
    } else {
      insertIndex = insertAt;
    }

    // Insert the row
    await insertRow(sheet, insertIndex, template);
    return { index: insertIndex, created: true };
  } else {
    // Column creation - similar logic but transpose
    // For now, throw not implemented
    throw new Error('createIfMissing for columns not yet implemented');
  }
}
```

**Step 5: Add insertRow helper**

```typescript
/**
 * Insert a row at a specific index with given values.
 */
export async function insertRow(
  sheet: SheetRef,
  rowIndex: number,
  values: unknown[]
): Promise<void> {
  // Get sheet ID
  const meta = await sheet.client.spreadsheets.get({
    spreadsheetId: sheet.spreadsheetId,
  });

  const sheetMeta = meta.data.sheets?.find(
    s => s.properties?.title === sheet.sheetName
  );
  const sheetId = sheetMeta?.properties?.sheetId;

  if (sheetId === undefined) {
    throw new Error(`Sheet "${sheet.sheetName}" not found`);
  }

  // Insert empty row
  await sheet.client.spreadsheets.batchUpdate({
    spreadsheetId: sheet.spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  // Write values to the new row
  const endCol = colIndexToLetter(values.length - 1);
  await sheet.client.spreadsheets.values.update({
    spreadsheetId: sheet.spreadsheetId,
    range: `'${sheet.sheetName}'!A${rowIndex + 1}:${endCol}${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values],
    },
  });
}
```

**Step 6: Run tests**

Run: `pnpm vitest run tests/integrations/sheets/toolkit.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/integrations/sheets/toolkit.ts src/integrations/sheets/types.ts tests/integrations/sheets/toolkit.test.ts
git commit -m "feat(sheets): add createIfMissing option to lookup"
```

---

## Summary

After completing all tasks, the sheets toolkit provides:

| Function | Purpose |
|----------|---------|
| `createSheetsClient` | Create authenticated Google Sheets client |
| `getValues` | Get values along an axis (row or column) |
| `lookup` | Find index by exact, fuzzy, or date match (with createIfMissing) |
| `setCellValue` | Write to a specific cell |
| `appendRow` | Append a row at the end |
| `insertRow` | Insert a row at a specific index |
| `deleteRow` | Delete a row |
| `getRecentActivity` | Find items with recent activity |

All functions are axis-agnostic where applicable. Fuzzy matching is delegated to a callback, keeping the toolkit LLM-agnostic.
