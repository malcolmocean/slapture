// src/integrations/sheets/toolkit.ts
import type { SheetRef, GetValuesConfig, LookupConfig, LookupResult, SetCellConfig, AppendRowConfig } from './types.js';

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

  return { index: null };
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
