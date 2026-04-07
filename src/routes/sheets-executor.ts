// src/routes/sheets-executor.ts
import type { Route, Capture } from '../types.js';
import type { SheetRef, SheetsAuthProvider } from '../integrations/sheets/types.js';
import { createSheetsClient } from '../integrations/sheets/auth.js';
import * as toolkit from '../integrations/sheets/toolkit.js';

export interface SheetsExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
  error?: string;
  data?: unknown;
}

/**
 * Sheets destination config - declarative specification of what to do.
 */
export interface SheetsDestinationConfig {
  spreadsheetId: string;
  sheetName: string;
  operation: SheetsOperation;
}

/**
 * Operations supported by the sheets executor.
 */
export type SheetsOperation =
  | AppendRowOperation
  | LookupSetCellOperation
  | LookupAppendToCellOperation;

/**
 * Append a new row to the sheet.
 * Used for: weight log
 */
export interface AppendRowOperation {
  type: 'append_row';
  columns: ColumnSpec[];
}

/**
 * Lookup coordinates and set a cell value.
 * Used for: bookantt (dual lookup → set cell)
 */
export interface LookupSetCellOperation {
  type: 'lookup_set_cell';
  rowLookup: LookupSpec;
  colLookup: LookupSpec;
  value: ValueSpec;
}

/**
 * Lookup a row, find first empty column in a range, write value there.
 * Used for: gwen memories
 */
export interface LookupAppendToCellOperation {
  type: 'lookup_append_to_row';
  rowLookup: LookupSpec;
  colRange: [number, number];
  value: ValueSpec;
}

/**
 * How to find a row or column index.
 */
export interface LookupSpec {
  axis: 'row' | 'col';
  /** Column index (if axis='row') or row index (if axis='col') to search in */
  at: number;
  /** How to get the value to search for */
  valueSource: ValueSpec;
  match: 'exact' | 'fuzzy' | 'date';
  range?: [number, number];
  /** Additional column indices to include as context for fuzzy matching (e.g. author column alongside title) */
  fuzzyContextColumns?: number[];
  /** If not found, create a new row/column with this template */
  createIfMissing?: {
    template: ValueSpec[];
    insertAt?: 'end' | number;
  };
}

/**
 * How to derive a value from the capture.
 */
export type ValueSpec =
  | { type: 'today' }
  | { type: 'payload' }  // Full payload
  | { type: 'extract'; pattern: string; group?: number }  // Regex extract from payload
  | { type: 'computed'; expression: string }  // Simple expression like "kg * 2.20462"
  | { type: 'literal'; value: unknown }
  | { type: 'field'; name: string };

/**
 * How to derive a column value for append_row.
 */
export type ColumnSpec =
  | { type: 'today'; format?: string }
  | { type: 'payload' }
  | { type: 'extract'; pattern: string; group?: number }
  | { type: 'computed'; expression: string }
  | { type: 'literal'; value: unknown }
  | { type: 'field'; name: string };

export class SheetsExecutor {
  private authProvider: SheetsAuthProvider;
  private anthropicApiKey: string | undefined;

  constructor(authProvider: SheetsAuthProvider, anthropicApiKey?: string) {
    this.authProvider = authProvider;
    this.anthropicApiKey = anthropicApiKey;
  }

  async execute(route: Route, capture: Capture): Promise<SheetsExecutionResult> {
    const config = route.destinationConfig as SheetsDestinationConfig;
    const payload = capture.parsed?.payload || capture.raw;
    const fields = capture.extractedFields ?? {};

    // Get sheets credentials
    const sheet = await this.getSheetRef(config.spreadsheetId, config.sheetName, capture.username);
    if (!sheet) {
      return {
        status: 'blocked_needs_auth',
        error: 'Google Sheets credentials not configured',
      };
    }

    try {
      const result = await this.executeOperation(sheet, config.operation, payload, fields);
      return {
        status: 'success',
        data: result,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getSheetRef(spreadsheetId: string, sheetName: string, userId: string): Promise<SheetRef | null> {
    const credentials = await this.authProvider.getCredentials(userId);
    if (!credentials) {
      return null;
    }

    const client = createSheetsClient(credentials);
    return { client, spreadsheetId, sheetName };
  }

  private async executeOperation(
    sheet: SheetRef,
    operation: SheetsOperation,
    payload: string,
    fields: Record<string, string>
  ): Promise<unknown> {
    switch (operation.type) {
      case 'append_row':
        return this.executeAppendRow(sheet, operation, payload, fields);
      case 'lookup_set_cell':
        return this.executeLookupSetCell(sheet, operation, payload, fields);
      case 'lookup_append_to_row':
        return this.executeLookupAppendToRow(sheet, operation, payload, fields);
      default:
        throw new Error(`Unknown operation type: ${(operation as any).type}`);
    }
  }

  private async executeAppendRow(
    sheet: SheetRef,
    operation: AppendRowOperation,
    payload: string,
    fields: Record<string, string>
  ): Promise<{ row: number }> {
    const context = this.buildContext(payload, fields);
    const values = operation.columns.map((col, index) =>
      this.resolveColumnSpec(col, context, index)
    );
    return toolkit.appendRow(sheet, { values });
  }

  private async executeLookupSetCell(
    sheet: SheetRef,
    operation: LookupSetCellOperation,
    payload: string,
    fields: Record<string, string>
  ): Promise<{ row: number; col: number }> {
    const context = this.buildContext(payload, fields);

    // Do row lookup
    const rowValue = this.resolveValueSpec(operation.rowLookup.valueSource, context);
    const createIfMissing = operation.rowLookup.createIfMissing
      ? {
          template: operation.rowLookup.createIfMissing.template.map((spec, i) =>
            this.resolveColumnSpec(spec as ColumnSpec, context, i)
          ),
          insertAt: operation.rowLookup.createIfMissing.insertAt,
        }
      : undefined;

    const rowResult = await toolkit.lookup(sheet, {
      axis: 'row',
      at: operation.rowLookup.at,
      value: rowValue,
      match: operation.rowLookup.match,
      range: operation.rowLookup.range,
      fuzzyMatcher: operation.rowLookup.match === 'fuzzy'
        ? await this.createFuzzyMatcher(sheet, operation.rowLookup)
        : undefined,
      createIfMissing,
    });

    if (rowResult.index === null) {
      throw new Error(`Row lookup failed: could not find "${rowValue}"`);
    }

    // Do col lookup
    const colValue = this.resolveValueSpec(operation.colLookup.valueSource, context);
    const colResult = await toolkit.lookup(sheet, {
      axis: 'col',
      at: operation.colLookup.at,
      value: colValue,
      match: operation.colLookup.match,
      range: operation.colLookup.range,
    });

    if (colResult.index === null) {
      throw new Error(`Column lookup failed: could not find "${colValue}"`);
    }

    // Set the cell value
    const cellValue = this.resolveValueSpec(operation.value, context);
    await toolkit.setCellValue(sheet, {
      row: rowResult.index,
      col: colResult.index,
      value: cellValue,
    });

    return { row: rowResult.index, col: colResult.index };
  }

  private async executeLookupAppendToRow(
    sheet: SheetRef,
    operation: LookupAppendToCellOperation,
    payload: string,
    fields: Record<string, string>
  ): Promise<{ row: number; col: number }> {
    const context = this.buildContext(payload, fields);

    // Do row lookup
    const rowValue = this.resolveValueSpec(operation.rowLookup.valueSource, context);
    const rowResult = await toolkit.lookup(sheet, {
      axis: 'row',
      at: operation.rowLookup.at,
      value: rowValue,
      match: operation.rowLookup.match,
      range: operation.rowLookup.range,
    });

    if (rowResult.index === null) {
      throw new Error(`Row lookup failed: could not find "${rowValue}"`);
    }

    // Find first empty column in the range
    const [colStart, colEnd] = operation.colRange;
    const values = await toolkit.getValues(sheet, {
      axis: 'col',
      at: rowResult.index,
      range: [colStart, colEnd],
    });

    let emptyColIndex = colStart;
    for (let i = 0; i < values.length; i++) {
      if (!values[i] || values[i] === '') {
        emptyColIndex = colStart + i;
        break;
      }
      // If no empty found, use next after last
      if (i === values.length - 1) {
        emptyColIndex = colStart + values.length;
      }
    }

    // Set the cell value
    const cellValue = this.resolveValueSpec(operation.value, context);
    await toolkit.setCellValue(sheet, {
      row: rowResult.index,
      col: emptyColIndex,
      value: cellValue,
    });

    return { row: rowResult.index, col: emptyColIndex };
  }

  private buildContext(payload: string, fields: Record<string, string> = {}): ExecutionContext {
    return {
      payload,
      today: new Date(),
      extractions: {},
      fields,
    };
  }

  private resolveValueSpec(spec: ValueSpec, context: ExecutionContext): unknown {
    switch (spec.type) {
      case 'today':
        return context.today;
      case 'payload':
        return context.payload;
      case 'extract': {
        const regex = new RegExp(spec.pattern, 'i');
        const match = context.payload.match(regex);
        if (!match) {
          throw new Error(`Extract pattern "${spec.pattern}" did not match payload "${context.payload}"`);
        }
        return match[spec.group ?? 1] ?? match[0];
      }
      case 'computed': {
        // Simple expression evaluation for things like "kg * 2.20462"
        // First extract any variables from prior extractions
        let expr = spec.expression;
        for (const [key, val] of Object.entries(context.extractions)) {
          expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(val));
        }
        // Evaluate safely (only arithmetic)
        return this.safeEval(expr);
      }
      case 'literal':
        return spec.value;
      case 'field': {
        const value = context.fields[spec.name];
        if (value === undefined) {
          throw new Error(`Field "${spec.name}" not found in extractedFields. Available: ${Object.keys(context.fields).join(', ')}`);
        }
        return value;
      }
      default:
        throw new Error(`Unknown value spec type: ${(spec as any).type}`);
    }
  }

  private resolveColumnSpec(spec: ColumnSpec, context: ExecutionContext, colIndex: number): unknown {
    switch (spec.type) {
      case 'today': {
        const format = spec.format ?? 'short';
        if (format === 'short') {
          return context.today.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
        }
        return context.today.toISOString();
      }
      case 'payload':
        return context.payload;
      case 'extract': {
        const regex = new RegExp(spec.pattern, 'i');
        const match = context.payload.match(regex);
        if (!match) {
          return ''; // Gracefully handle no match for columns
        }
        const extracted = match[spec.group ?? 1] ?? match[0];
        // Store in context for computed expressions, indexed by column number
        context.extractions[`_col${colIndex}`] = extracted;
        // If it looks like a number, return as number
        const num = parseFloat(extracted);
        if (!isNaN(num) && String(num) === extracted.trim()) {
          return num;
        }
        return extracted;
      }
      case 'computed': {
        let expr = spec.expression;
        for (const [key, val] of Object.entries(context.extractions)) {
          expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(val));
        }
        return this.safeEval(expr);
      }
      case 'literal':
        return spec.value;
      case 'field': {
        const value = context.fields[spec.name];
        if (value === undefined) {
          return '';
        }
        context.extractions[`_col${colIndex}`] = value;
        const num = parseFloat(value);
        if (!isNaN(num) && String(num) === value.trim()) {
          return num;
        }
        return value;
      }
      default:
        throw new Error(`Unknown column spec type: ${(spec as any).type}`);
    }
  }

  private safeEval(expr: string): number {
    // Only allow numbers and basic arithmetic operators
    const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, '');
    if (sanitized !== expr.trim()) {
      throw new Error(`Invalid expression: ${expr}`);
    }
    // eslint-disable-next-line no-eval
    return eval(sanitized);
  }

  private async createFuzzyMatcher(
    sheet?: SheetRef,
    lookupSpec?: LookupSpec
  ): Promise<(candidates: string[], target: string) => Promise<number | null>> {
    // Pre-read context columns (e.g. author alongside title) if configured
    let contextData: Map<number, string[]> = new Map();
    if (sheet && lookupSpec?.fuzzyContextColumns?.length && lookupSpec.range) {
      for (const colIdx of lookupSpec.fuzzyContextColumns) {
        const values = await toolkit.getValues(sheet, {
          axis: 'row',
          at: colIdx,
          range: lookupSpec.range,
        });
        contextData.set(colIdx, values.map(v => String(v ?? '')));
      }
    }

    // Build enriched candidate strings (e.g. "Title | Author")
    const enrichCandidates = (candidates: string[]): string[] => {
      if (contextData.size === 0) return candidates;
      return candidates.map((c, i) => {
        const extra = [...contextData.values()].map(col => col[i] || '').filter(v => v).join(' | ');
        return extra ? `${c} | ${extra}` : c;
      });
    };

    if (!this.anthropicApiKey) {
      return async (candidates: string[], target: string): Promise<number | null> => {
        const lowerTarget = target.toLowerCase();
        const enriched = enrichCandidates(candidates);
        for (let i = 0; i < enriched.length; i++) {
          const candidate = enriched[i].toLowerCase();
          if (candidate.includes(lowerTarget) || lowerTarget.includes(candidate)) {
            return i;
          }
        }
        return null;
      };
    }

    const apiKey = this.anthropicApiKey;
    return async (candidates: string[], target: string): Promise<number | null> => {
      const enriched = enrichCandidates(candidates);

      // First try substring match on enriched candidates
      const lowerTarget = target.toLowerCase();
      for (let i = 0; i < enriched.length; i++) {
        const candidate = enriched[i].toLowerCase();
        if (candidate.includes(lowerTarget) || lowerTarget.includes(candidate)) {
          return i;
        }
      }

      // No substring match — ask Haiku
      try {
        const numbered = enriched
          .filter(c => c.trim())
          .map((c, i) => `${i}: ${c}`)
          .join('\n');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 20,
            messages: [{
              role: 'user',
              content: `Which of these entries matches "${target}"? Consider alternate titles, abbreviations, author last names, and common ways people refer to books/items. Respond with ONLY the number, or "none" if no match.\n\n${numbered}`,
            }],
          }),
        });

        if (!response.ok) {
          console.error(`[FuzzyMatcher] Haiku API error: ${response.status}`);
          return null;
        }

        const data = await response.json() as { content: Array<{ text: string }> };
        const text = data.content?.[0]?.text?.trim() ?? '';
        if (text === 'none') return null;
        const idx = parseInt(text);
        if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
          return idx;
        }
        return null;
      } catch (error) {
        console.error(`[FuzzyMatcher] Error:`, error);
        return null;
      }
    };
  }
}

interface ExecutionContext {
  payload: string;
  today: Date;
  extractions: Record<string, unknown>;
  fields: Record<string, string>;
}
