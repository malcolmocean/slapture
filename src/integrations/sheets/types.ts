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

export interface SetCellConfig {
  /** 0-indexed row number */
  row: number;
  /** 0-indexed column number */
  col: number;
  /** Value to write to the cell */
  value: unknown;
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
  /** Optional: index of label row/column for items */
  labelAt?: number;
}

export interface RecentActivityResult {
  /** Item index (row or column depending on itemAxis) */
  index: number;
  /** Most recent date with activity */
  lastActiveDate: Date | null;
  /** Index of the most recent active date cell */
  lastActiveIndex: number | null;
  /** The label/name of this item (from a label column/row if provided) */
  label?: string;
}

export interface AppendRowConfig {
  /** Values to append as a new row */
  values: unknown[];
}
