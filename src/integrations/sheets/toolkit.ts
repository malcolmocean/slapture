// src/integrations/sheets/toolkit.ts
import type { sheets_v4 } from 'googleapis';
import type { SheetRef, GetValuesConfig, LookupConfig, LookupResult, SetCellConfig, AppendRowConfig, RecentActivityConfig, RecentActivityResult } from './types.js';

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
 * Google Sheets serial date epoch: December 30, 1899
 * Serial number = days since that date
 *
 * Valid range: ~25569 (Jan 1, 1970) to ~73050 (Dec 31, 2099)
 * We use a slightly wider range to catch dates from 1950-2100
 */
const SHEETS_EPOCH_OFFSET = 25569; // Days between Dec 30, 1899 and Jan 1, 1970
const MS_PER_DAY = 86400 * 1000;
const MIN_VALID_SERIAL = 18264;  // ~1950
const MAX_VALID_SERIAL = 73415;  // ~2100

/**
 * Convert a Google Sheets serial date number to a JavaScript Date.
 * Returns null if the number is outside the valid date range.
 */
export function sheetsSerialToDate(serial: number): Date | null {
  if (serial < MIN_VALID_SERIAL || serial > MAX_VALID_SERIAL) {
    return null;
  }
  // Convert: serial is days since Dec 30, 1899
  // JS Date uses ms since Jan 1, 1970
  const msFromUnixEpoch = (serial - SHEETS_EPOCH_OFFSET) * MS_PER_DAY;
  return new Date(msFromUnixEpoch);
}

/**
 * Check if a value looks like a Google Sheets serial date.
 * NOTE: This is a heuristic fallback. Prefer using getCellFormatTypes() to check
 * if a cell is actually formatted as a date.
 */
export function isSheetSerialDate(value: unknown): value is number {
  return typeof value === 'number' && value >= MIN_VALID_SERIAL && value <= MAX_VALID_SERIAL;
}

/** Cell format types returned by getCellFormatTypes */
export type CellFormatType = 'DATE' | 'DATE_TIME' | 'TIME' | 'NUMBER' | 'TEXT' | 'CURRENCY' | 'PERCENT' | 'SCIENTIFIC' | 'OTHER';

/**
 * Get the format types for cells in a range.
 * Returns an array of format types corresponding to the requested axis.
 *
 * This is useful for determining if numeric values are actually dates
 * (which are stored as serial numbers but formatted as dates).
 */
export async function getCellFormatTypes(
  sheet: SheetRef,
  config: GetValuesConfig
): Promise<CellFormatType[]> {
  const { axis, at, range } = config;
  const [start, end] = range ?? [0, 999];

  let rangeNotation: string;

  if (axis === 'row') {
    const col = colIndexToLetter(at);
    rangeNotation = `'${sheet.sheetName}'!${col}${start + 1}:${col}${end + 1}`;
  } else {
    const startCol = colIndexToLetter(start);
    const endCol = colIndexToLetter(end);
    rangeNotation = `'${sheet.sheetName}'!${startCol}${at + 1}:${endCol}${at + 1}`;
  }

  const response = await sheet.client.spreadsheets.get({
    spreadsheetId: sheet.spreadsheetId,
    ranges: [rangeNotation],
    includeGridData: true,
  });

  const sheetData = response.data.sheets?.[0]?.data?.[0];
  if (!sheetData?.rowData) {
    return [];
  }

  const formatTypes: CellFormatType[] = [];

  if (axis === 'row') {
    // Each row has one cell
    for (const row of sheetData.rowData) {
      const cell = row.values?.[0];
      formatTypes.push(parseCellFormatType(cell?.effectiveFormat?.numberFormat?.type));
    }
  } else {
    // Single row with multiple cells
    const row = sheetData.rowData[0];
    for (const cell of row?.values ?? []) {
      formatTypes.push(parseCellFormatType(cell?.effectiveFormat?.numberFormat?.type));
    }
  }

  return formatTypes;
}

function parseCellFormatType(type: string | null | undefined): CellFormatType {
  switch (type) {
    case 'DATE': return 'DATE';
    case 'DATE_TIME': return 'DATE_TIME';
    case 'TIME': return 'TIME';
    case 'NUMBER': return 'NUMBER';
    case 'TEXT': return 'TEXT';
    case 'CURRENCY': return 'CURRENCY';
    case 'PERCENT': return 'PERCENT';
    case 'SCIENTIFIC': return 'SCIENTIFIC';
    default: return 'OTHER';
  }
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
    valueRenderOption: 'UNFORMATTED_VALUE',
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
  const { axis, at, value, match = 'exact', fuzzyMatcher, range, createIfMissing } = config;

  const values = await getValues(sheet, { axis, at, range });

  const [startOffset] = range ?? [0, 999];

  // Try to find a match
  let foundResult: LookupResult | null = null;

  if (match === 'exact') {
    const stringValue = String(value);
    for (let i = 0; i < values.length; i++) {
      const cellValue = values[i];
      // Check both exact match and "starts with" for truncated values
      if (cellValue !== null && cellValue !== undefined) {
        const cellStr = String(cellValue);
        if (cellStr === stringValue || cellStr.startsWith(stringValue) || stringValue.startsWith(cellStr)) {
          foundResult = { index: startOffset + i, matchedValue: cellValue };
          break;
        }
      }
    }
  } else if (match === 'fuzzy') {
    if (!fuzzyMatcher) {
      throw new Error('fuzzyMatcher callback required for fuzzy match');
    }
    const stringValues = values.map(v => String(v ?? ''));
    const matchedLocalIndex = await fuzzyMatcher(stringValues, String(value));
    if (matchedLocalIndex !== null) {
      foundResult = { index: startOffset + matchedLocalIndex, matchedValue: values[matchedLocalIndex] };
    }
  } else if (match === 'date') {
    const targetDate = value instanceof Date ? value : new Date(String(value));
    const targetDay = targetDate.getDate();
    const targetMonth = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();

    // Fetch cell format types to properly detect date-formatted cells
    const formatTypes = await getCellFormatTypes(sheet, { axis, at, range });

    for (let i = 0; i < values.length; i++) {
      const cellValue = values[i];
      if (cellValue === null || cellValue === undefined || cellValue === '') continue;

      const formatType = formatTypes[i];
      const isDateFormatted = formatType === 'DATE' || formatType === 'DATE_TIME';

      // If cell is formatted as a date and value is a number, treat as serial date
      if (isDateFormatted && typeof cellValue === 'number') {
        const cellDate = sheetsSerialToDate(cellValue);
        if (cellDate &&
            cellDate.getUTCDate() === targetDay &&
            cellDate.getUTCMonth() === targetMonth &&
            cellDate.getUTCFullYear() === targetYear) {
          foundResult = { index: startOffset + i, matchedValue: cellValue };
          break;
        }
        continue; // It's a date-formatted cell, don't try other parsing methods
      }

      const cellStr = String(cellValue).trim();

      // Try parsing as day-of-month number (legacy: small integers 1-31)
      const dayNum = parseInt(cellStr, 10);
      if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31 && dayNum === targetDay) {
        foundResult = { index: startOffset + i, matchedValue: cellValue };
        break;
      }

      // Try parsing as full date string (gwen_memories format: "May 23, 2024")
      const parsedDate = new Date(cellStr);
      if (!isNaN(parsedDate.getTime())) {
        if (
          parsedDate.getDate() === targetDay &&
          parsedDate.getMonth() === targetMonth &&
          parsedDate.getFullYear() === targetYear
        ) {
          foundResult = { index: startOffset + i, matchedValue: cellValue };
          break;
        }
      }
    }
  }

  // If we found a match, return it
  if (foundResult !== null) {
    return foundResult;
  }

  // If not found and createIfMissing specified, create the row/column
  if (createIfMissing) {
    const { template, insertAt = 'end' } = createIfMissing;

    if (axis === 'row') {
      // Find where to insert
      let insertIndex: number;
      if (insertAt === 'end') {
        // Find last non-empty row in the range
        const [start] = range ?? [0, 999];
        let lastNonEmpty = start;
        for (let i = 0; i < values.length; i++) {
          if (values[i] !== null && values[i] !== undefined && values[i] !== '') {
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
      // Column creation - not implemented yet
      throw new Error('createIfMissing for columns not yet implemented');
    }
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
  const dateHeadersConfig: GetValuesConfig = {
    axis: itemAxis === 'row' ? 'col' : 'row',
    at: dateAt,
    range: dateRange,
  };
  const dateHeaders = await getValues(sheet, dateHeadersConfig);
  const dateHeaderFormats = await getCellFormatTypes(sheet, dateHeadersConfig);

  // Get labels if requested
  let labels: unknown[] = [];
  if (labelAt !== undefined) {
    labels = await getValues(sheet, {
      axis: itemAxis,
      at: labelAt,
      range: itemRange,
    });
  }

  // Fetch all data in one batch call (2D range)
  // For itemAxis='row': rows are items, columns are dates
  // For itemAxis='col': columns are items, rows are dates
  const startCol = itemAxis === 'row' ? colIndexToLetter(dateStart) : colIndexToLetter(itemStart);
  const endCol = itemAxis === 'row' ? colIndexToLetter(dateEnd) : colIndexToLetter(itemEnd);
  const startRow = itemAxis === 'row' ? itemStart + 1 : dateStart + 1;
  const endRow = itemAxis === 'row' ? itemEnd + 1 : dateEnd + 1;

  const rangeNotation = `'${sheet.sheetName}'!${startCol}${startRow}:${endCol}${endRow}`;

  const response = await sheet.client.spreadsheets.values.get({
    spreadsheetId: sheet.spreadsheetId,
    range: rangeNotation,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const allValues = response.data.values ?? [];

  const results: RecentActivityResult[] = [];
  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  // Process each item
  const itemCount = itemEnd - itemStart + 1;
  for (let itemOffset = 0; itemOffset < itemCount; itemOffset++) {
    const itemIdx = itemStart + itemOffset;

    // Get values for this item from the batch result
    let values: unknown[];
    if (itemAxis === 'row') {
      // Each row in allValues is an item, each column is a date
      values = allValues[itemOffset] ?? [];
    } else {
      // Each column in allValues is an item - transpose
      values = allValues.map(row => row[itemOffset] ?? null);
    }

    let lastActiveIndex: number | null = null;
    let lastActiveDate: Date | null = null;

    // Scan backwards to find most recent activity
    for (let i = values.length - 1; i >= 0; i--) {
      const val = values[i];
      if (val !== null && val !== undefined && val !== '' && val !== '0') {
        // Parse the date header to get actual date
        const dateHeader = dateHeaders[i];
        const formatType = dateHeaderFormats[i];
        const isDateFormatted = formatType === 'DATE' || formatType === 'DATE_TIME';

        let date: Date | null = null;

        // If cell is formatted as a date and value is a number, treat as serial date
        if (isDateFormatted && typeof dateHeader === 'number') {
          date = sheetsSerialToDate(dateHeader);
        } else {
          // Fallback: try parsing as day-of-month number (legacy format)
          const dayNum = parseInt(String(dateHeader), 10);
          if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
            // Assume current month/year for day-of-month format
            date = new Date(today.getFullYear(), today.getMonth(), dayNum);
            if (date > today) {
              // Day is in the future this month, must be last month
              date.setMonth(date.getMonth() - 1);
            }
          }
        }

        if (date && date >= cutoffDate) {
          lastActiveIndex = dateStart + i;
          lastActiveDate = date;
          break;
        }
      }
    }

    if (lastActiveDate !== null) {
      results.push({
        index: itemIdx,
        lastActiveDate,
        lastActiveIndex,
        label: labels[itemOffset] !== undefined ? String(labels[itemOffset]) : undefined,
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

export interface CreateSpreadsheetResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

/**
 * Create a new Google Sheets spreadsheet.
 * Takes the raw Sheets API client (not a SheetRef, since there's no spreadsheet yet).
 */
export async function createSpreadsheet(
  client: sheets_v4.Sheets,
  title: string,
  sheetNames?: string[],
): Promise<CreateSpreadsheetResult> {
  const sheets = sheetNames?.map(name => ({ properties: { title: name } }));

  const response = await client.spreadsheets.create({
    requestBody: {
      properties: { title },
      ...(sheets ? { sheets } : {}),
    },
  });

  const spreadsheetId = response.data.spreadsheetId!;
  const spreadsheetUrl = response.data.spreadsheetUrl!;

  return { spreadsheetId, spreadsheetUrl };
}
