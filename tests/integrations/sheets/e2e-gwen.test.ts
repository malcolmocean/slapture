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
    // Find the row for May 25, 2025 (which exists but has empty memories)
    const targetDate = new Date(2025, 4, 25);

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
