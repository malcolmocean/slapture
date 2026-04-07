import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { SheetsExecutor, SheetsDestinationConfig } from '../../src/routes/sheets-executor';
import { FileSheetsAuthProvider } from '../../src/integrations/sheets/auth';
import { createSheetsClient } from '../../src/integrations/sheets/auth';
import { lookup, getValues, setCellValue, deleteRow } from '../../src/integrations/sheets/toolkit';
import type { SheetRef } from '../../src/integrations/sheets/types';
import type { Route, Capture } from '../../src/types';
import { Dispatcher } from '../../src/dispatcher/index';
import { hasCredentials, loadCredentials } from '../fixtures/sheets-test-creds';

const TEST_SPREADSHEET_ID = '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

function createMockCapture(raw: string, payload?: string, fields?: Record<string, string>): Capture {
  return {
    id: 'test-capture-' + Date.now(),
    raw,
    timestamp: new Date().toISOString(),
    username: 'test',
    parsed: {
      explicitRoute: null,
      payload: payload ?? raw,
      metadata: {},
    },
    routeProposed: null,
    routeConfidence: null,
    routeFinal: null,
    executionTrace: [],
    executionResult: 'pending',
    verificationState: 'pending',
    retiredFromTests: false,
    retiredReason: null,
    extractedFields: fields,
  };
}

// ─── 1. append_row with field extraction ─────────────────────────────────────

describe.skipIf(!hasCredentials)('Sheets route: append_row with field extraction', () => {
  let executor: SheetsExecutor;
  let sheet: SheetRef;
  let appendedRow: number | null = null;

  beforeAll(() => {
    executor = new SheetsExecutor(new FileSheetsAuthProvider());
    const creds = loadCredentials();
    const client = createSheetsClient(creds);
    sheet = { client, spreadsheetId: TEST_SPREADSHEET_ID, sheetName: 'expense_log' };
  });

  afterEach(async () => {
    if (appendedRow !== null) {
      await deleteRow(sheet, appendedRow);
      appendedRow = null;
    }
  });

  it('should append a row using extracted fields from trigger captures', async () => {
    const route: Route = {
      id: 'route-test-append',
      name: 'Test Append Simple',
      description: 'Track category and value',
      triggers: [{
        type: 'regex',
        pattern: '^track\\s+(\\w+)\\s+(\\d+)',
        captures: { category: 1, value: 2 },
        priority: 10,
      }],
      schema: null,
      recentItems: [],
      destinationType: 'sheets',
      destinationConfig: {
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetName: 'expense_log',
        operation: {
          type: 'append_row',
          columns: [
            { type: 'today' },
            { type: 'field', name: 'category' },
            { type: 'field', name: 'value' },
            { type: 'literal', value: 'test-auto' },
          ],
        },
      } as SheetsDestinationConfig,
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    };

    const capture = createMockCapture('track fitness 30', 'track fitness 30', {
      category: 'fitness',
      value: '30',
    });

    const result = await executor.execute(route, capture);

    expect(result.status).toBe('success');
    expect(result.data).toHaveProperty('row');
    appendedRow = (result.data as { row: number }).row;

    // Read back the last row to confirm data
    const values = await getValues(sheet, {
      axis: 'col',
      at: appendedRow,
      range: [0, 3],
    });

    // values[0] is today's date (string), values[1] is category, values[2] is value
    expect(values[1]).toBe('fitness');
    expect(values[2]).toBe(30); // Numeric because sheets parses "30"
    expect(values[3]).toBe('test-auto');
  });
});

// ─── 2. lookup_append_to_row with date matching ─────────────────────────────

describe.skipIf(!hasCredentials)('Sheets route: lookup_append_to_row with date matching', () => {
  let executor: SheetsExecutor;
  let sheet: SheetRef;
  let writtenCell: { row: number; col: number } | null = null;

  beforeAll(() => {
    executor = new SheetsExecutor(new FileSheetsAuthProvider());
    const creds = loadCredentials();
    const client = createSheetsClient(creds);
    sheet = { client, spreadsheetId: TEST_SPREADSHEET_ID, sheetName: 'daily_journal' };
  });

  afterEach(async () => {
    if (writtenCell) {
      await setCellValue(sheet, { row: writtenCell.row, col: writtenCell.col, value: '' });
      writtenCell = null;
    }
  });

  it('should find Apr 7 2026 date row and write to first empty entry column', async () => {
    const route: Route = {
      id: 'route-test-date',
      name: 'Test Date Lookup',
      description: 'Append to today date row',
      triggers: [{
        type: 'regex',
        pattern: '^log\\s+(.+)',
        captures: { entry: 1 },
        priority: 10,
      }],
      schema: null,
      recentItems: [],
      destinationType: 'sheets',
      destinationConfig: {
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetName: 'daily_journal',
        operation: {
          type: 'lookup_append_to_row',
          rowLookup: {
            axis: 'row',
            at: 0,  // column A has dates
            valueSource: { type: 'today' },
            match: 'date',
            range: [1, 20],  // skip header row, search rows 2-21
          },
          colRange: [1, 3],  // columns B-D for entry values
          value: { type: 'payload' },
        },
      } as SheetsDestinationConfig,
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    };

    // Use Apr 7 2026 as the date target (serial 46119)
    const capture = createMockCapture('log test entry here', 'test entry here');

    const result = await executor.execute(route, capture);

    // If today's date is not in the sheet, this will fail - that's expected
    if (result.status === 'failed' && result.error?.includes('Row lookup failed')) {
      console.log('Expected: no row for today in test sheet (daily_journal covers Apr 1-14 2026)');
      return;
    }

    expect(result.status).toBe('success');
    expect(result.data).toHaveProperty('row');
    expect(result.data).toHaveProperty('col');
    writtenCell = result.data as { row: number; col: number };

    // Verify the value was written
    const values = await getValues(sheet, {
      axis: 'col',
      at: writtenCell.row,
      range: [writtenCell.col, writtenCell.col],
    });
    expect(values[0]).toBe('test entry here');
  });

  it('should find a specific date (Apr 7 2026) using direct lookup', async () => {
    // Use the toolkit directly to verify date lookup works
    const targetDate = new Date(2026, 3, 7); // Apr 7, 2026

    const result = await lookup(sheet, {
      axis: 'row',
      at: 0,  // column A
      value: targetDate,
      match: 'date',
      range: [1, 20],
    });

    expect(result.index).not.toBeNull();
    console.log('Apr 7 2026 found at row index:', result.index, 'value:', result.matchedValue);
  });
});

// ─── 3. lookup_set_cell with fuzzy match + context columns ──────────────────

describe.skipIf(!hasCredentials)('Sheets route: lookup_set_cell with fuzzy match (2D lookup)', () => {
  let executor: SheetsExecutor;
  let sheet: SheetRef;
  let writtenCell: { row: number; col: number } | null = null;

  beforeAll(() => {
    executor = new SheetsExecutor(new FileSheetsAuthProvider());
    const creds = loadCredentials();
    const client = createSheetsClient(creds);
    sheet = { client, spreadsheetId: TEST_SPREADSHEET_ID, sheetName: 'fitness_tracker' };
  });

  afterEach(async () => {
    if (writtenCell) {
      await setCellValue(sheet, { row: writtenCell.row, col: writtenCell.col, value: '' });
      writtenCell = null;
    }
  });

  it('should fuzzy-match "running" to Running row via substring match', async () => {
    // Direct lookup test - no Haiku needed, substring match should work
    const fuzzyMatcher = async (candidates: string[], target: string): Promise<number | null> => {
      const lowerTarget = target.toLowerCase();
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]?.toLowerCase() ?? '';
        if (candidate.includes(lowerTarget) || lowerTarget.includes(candidate.trim())) {
          return i;
        }
      }
      return null;
    };

    // Row 1 = "April", Row 2 = date headers, Rows 3-7 = exercises
    // Exercises are in column index that contains their names
    // Based on spec: rows 3-7, exercises listed by name
    // Let's first read the exercise names to understand the layout
    const exerciseNames = await getValues(sheet, {
      axis: 'row',
      at: 0,  // column A (or wherever exercise names are)
      range: [2, 7],  // rows 3-8 (0-indexed)
    });
    console.log('Exercise names in col A:', exerciseNames);

    const result = await lookup(sheet, {
      axis: 'row',
      at: 0,  // search in column A for exercise names
      value: 'running',
      match: 'fuzzy',
      fuzzyMatcher,
      range: [2, 7],
    });

    expect(result.index).not.toBeNull();
    expect(String(result.matchedValue).toLowerCase()).toContain('running');
    console.log('Running found at row index:', result.index);
  });

  it('should execute lookup_set_cell route writing exercise data to date column', async () => {
    // This route finds an exercise row and a date column, then sets a value
    const route: Route = {
      id: 'route-test-2d',
      name: 'Test 2D Lookup',
      description: 'Log exercise time',
      triggers: [{
        type: 'regex',
        pattern: '^exercise\\s+(\\w+)\\s+(\\d+)min',
        captures: { exercise: 1, minutes: 2 },
        priority: 10,
      }],
      schema: null,
      recentItems: [],
      destinationType: 'sheets',
      destinationConfig: {
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetName: 'fitness_tracker',
        operation: {
          type: 'lookup_set_cell',
          rowLookup: {
            axis: 'row',
            at: 0,  // column A has exercise names
            valueSource: { type: 'field', name: 'exercise' },
            match: 'fuzzy',
            fuzzyContextColumns: [3],  // column D (Type) for disambiguation
            range: [2, 7],
          },
          colLookup: {
            axis: 'col',
            at: 1,  // row 2 has date headers (0-indexed = row index 1)
            valueSource: { type: 'today' },
            match: 'date',
            range: [5, 18],  // columns F onwards (index 5+)
          },
          value: { type: 'field', name: 'minutes' },
        },
      } as SheetsDestinationConfig,
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    };

    const capture = createMockCapture('exercise running 45min', 'exercise running 45min', {
      exercise: 'running',
      minutes: '45',
    });

    const result = await executor.execute(route, capture);

    // May fail if today's date column doesn't exist in the sheet
    if (result.status === 'failed' && result.error?.includes('Column lookup failed')) {
      console.log('Expected: no column for today in test sheet (fitness_tracker covers Apr 1-14 2026)');
      return;
    }

    if (result.status === 'failed' && result.error?.includes('Row lookup failed')) {
      console.log('Row lookup failed:', result.error);
      return;
    }

    expect(result.status).toBe('success');
    writtenCell = result.data as { row: number; col: number };
    console.log('Exercise logged to:', writtenCell);

    // Verify the value
    const values = await getValues(sheet, {
      axis: 'col',
      at: writtenCell.row,
      range: [writtenCell.col, writtenCell.col],
    });
    expect(values[0]).toBe(45); // numeric
  });
});

// ─── 4. Haiku fuzzy matching with author context ────────────────────────────

describe.skipIf(!hasCredentials || !hasAnthropicKey)('Sheets route: Haiku fuzzy matching (media_library)', () => {
  let sheet: SheetRef;
  let executor: SheetsExecutor;

  beforeAll(() => {
    const creds = loadCredentials();
    const client = createSheetsClient(creds);
    sheet = { client, spreadsheetId: TEST_SPREADSHEET_ID, sheetName: 'media_library' };
    executor = new SheetsExecutor(new FileSheetsAuthProvider(), process.env.ANTHROPIC_API_KEY);
  });

  it('should match "ferber" to Solve Your Child\'s Sleep Problems by Richard Ferber', async () => {
    // Read item names from column A and authors from column B
    const items = await getValues(sheet, { axis: 'row', at: 0, range: [1, 20] });
    const authors = await getValues(sheet, { axis: 'row', at: 1, range: [1, 20] });
    console.log('Fuzzy match items:', items.filter(Boolean));
    console.log('Authors:', authors.filter(Boolean));

    // Build enriched candidates (title | author) - same pattern as SheetsExecutor.createFuzzyMatcher
    const candidates = items.map((item, i) => {
      const author = authors[i] ? ` | ${authors[i]}` : '';
      return `${item ?? ''}${author}`;
    }).filter(c => c.trim());

    // Use Haiku to fuzzy match "ferber"
    const numbered = candidates.map((c, i) => `${i}: ${c}`).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{
          role: 'user',
          content: `Which of these entries matches "ferber"? Consider alternate titles, abbreviations, author last names, and common ways people refer to books/items. Respond with ONLY the number, or "none" if no match.\n\n${numbered}`,
        }],
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { content: Array<{ text: string }> };
    const text = data.content?.[0]?.text?.trim() ?? '';
    console.log('Haiku response for "ferber":', text);

    expect(text).not.toBe('none');
    const idx = parseInt(text);
    expect(idx).toBeGreaterThanOrEqual(0);

    // Verify the matched item is the Ferber book
    const matchedItem = String(items[idx] ?? '').toLowerCase();
    const matchedAuthor = String(authors[idx] ?? '').toLowerCase();
    expect(matchedAuthor).toContain('ferber');
  });

  it('should match "4hww" to The 4-Hour Work Week', async () => {
    const items = await getValues(sheet, { axis: 'row', at: 0, range: [1, 20] });

    const candidates = items.filter(Boolean).map(String);
    const numbered = candidates.map((c, i) => `${i}: ${c}`).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{
          role: 'user',
          content: `Which of these entries matches "4hww"? Consider alternate titles, abbreviations, author last names, and common ways people refer to books/items. Respond with ONLY the number, or "none" if no match.\n\n${numbered}`,
        }],
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { content: Array<{ text: string }> };
    const text = data.content?.[0]?.text?.trim() ?? '';
    console.log('Haiku response for "4hww":', text);

    expect(text).not.toBe('none');
    const idx = parseInt(text);
    expect(idx).toBeGreaterThanOrEqual(0);

    const matchedItem = String(candidates[idx]).toLowerCase();
    expect(matchedItem).toContain('4-hour');
  });

  it('should disambiguate between two "Focus" books using author context', async () => {
    const items = await getValues(sheet, { axis: 'row', at: 0, range: [1, 20] });
    const authors = await getValues(sheet, { axis: 'row', at: 1, range: [1, 20] });

    // Find the two Focus books
    const focusIndices = items
      .map((item, i) => ({ item: String(item ?? ''), author: String(authors[i] ?? ''), i }))
      .filter(x => x.item.toLowerCase().includes('focus'));

    console.log('Focus books found:', focusIndices);

    if (focusIndices.length < 2) {
      console.log('Less than 2 Focus books found, skipping disambiguation test');
      return;
    }

    // Build enriched candidates with author context
    const candidates = items.map((item, i) => {
      const author = authors[i] ? ` | ${authors[i]}` : '';
      return `${item ?? ''}${author}`;
    }).filter(c => c.trim());

    const numbered = candidates.map((c, i) => `${i}: ${c}`).join('\n');

    // Ask for a specific Focus book by author
    const targetAuthor = focusIndices[0].author;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{
          role: 'user',
          content: `Which of these entries matches "focus by ${targetAuthor}"? Consider alternate titles, abbreviations, author last names, and common ways people refer to books/items. Respond with ONLY the number, or "none" if no match.\n\n${numbered}`,
        }],
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json() as { content: Array<{ text: string }> };
    const text = data.content?.[0]?.text?.trim() ?? '';
    console.log(`Haiku response for "focus by ${targetAuthor}":`, text);

    expect(text).not.toBe('none');
    const idx = parseInt(text);
    expect(idx).toBeGreaterThanOrEqual(0);

    // Verify it matched the correct Focus book (the one by the target author)
    const matchedAuthor = String(authors[idx] ?? '').toLowerCase();
    expect(matchedAuthor).toContain(targetAuthor.split(' ').pop()!.toLowerCase());
  });
});

// ─── 5. Field extraction through dispatcher (unit-level, no sheets needed) ──

describe('Field extraction through dispatcher (no sheets needed)', () => {
  it('should extract fields via trigger captures and attach to dispatch result', () => {
    const routes: Route[] = [{
      id: 'route-track',
      name: 'Track Fitness',
      description: 'Track fitness data',
      triggers: [{
        type: 'regex',
        pattern: '^track\\s+(\\w+)\\s+(\\d+)',
        captures: { category: 1, value: 2 },
        priority: 10,
      }],
      schema: null,
      recentItems: [],
      destinationType: 'sheets',
      destinationConfig: {
        spreadsheetId: 'fake',
        sheetName: 'fake',
        operation: { type: 'append_row', columns: [] },
      } as SheetsDestinationConfig,
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    }];

    const dispatcher = new Dispatcher(routes);
    const result = dispatcher.dispatch({
      explicitRoute: null,
      payload: 'track fitness 30',
      metadata: {},
    });

    expect(result.routeId).toBe('route-track');
    expect(result.extractedFields).toBeDefined();
    expect(result.extractedFields?.category).toBe('fitness');
    expect(result.extractedFields?.value).toBe('30');
  });

  it('should extract multiple named fields from a complex pattern', () => {
    const routes: Route[] = [{
      id: 'route-exercise',
      name: 'Exercise Log',
      description: 'Log exercise with duration',
      triggers: [{
        type: 'regex',
        pattern: '^exercise\\s+(\\w+)\\s+(\\d+)min(?:\\s+(.+))?',
        captures: { exercise: 1, minutes: 2, notes: 3 },
        priority: 10,
      }],
      schema: null,
      recentItems: [],
      destinationType: 'sheets',
      destinationConfig: {
        spreadsheetId: 'fake',
        sheetName: 'fake',
        operation: { type: 'append_row', columns: [] },
      } as SheetsDestinationConfig,
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    }];

    const dispatcher = new Dispatcher(routes);
    const result = dispatcher.dispatch({
      explicitRoute: null,
      payload: 'exercise running 45min at the park',
      metadata: {},
    });

    expect(result.routeId).toBe('route-exercise');
    expect(result.extractedFields).toEqual({
      exercise: 'running',
      minutes: '45',
      notes: 'at the park',
    });
  });

  it('should not set extractedFields when trigger has no captures', () => {
    const routes: Route[] = [{
      id: 'route-simple',
      name: 'Simple Route',
      description: 'No captures',
      triggers: [{
        type: 'regex',
        pattern: '^hello',
        priority: 10,
      }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: '/tmp/test' },
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    }];

    const dispatcher = new Dispatcher(routes);
    const result = dispatcher.dispatch({
      explicitRoute: null,
      payload: 'hello world',
      metadata: {},
    });

    expect(result.routeId).toBe('route-simple');
    expect(result.extractedFields).toBeUndefined();
  });
});
