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
