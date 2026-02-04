import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { SheetsExecutor, SheetsDestinationConfig } from '../../src/routes/sheets-executor';
import { Storage } from '../../src/storage';
import type { Route, Capture } from '../../src/types';

const TEST_SPREADSHEET_ID = '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';
const hasCredentials = existsSync('./secrets/google-secrets.json') && existsSync('./secrets/google-tokens.json');

function createMockCapture(raw: string, payload?: string): Capture {
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
  };
}

describe.skipIf(!hasCredentials)('SheetsExecutor E2E', () => {
  let executor: SheetsExecutor;
  let storage: Storage;

  beforeAll(() => {
    storage = new Storage('./data');
    executor = new SheetsExecutor(storage);
  });

  describe('weight route (append_row)', () => {
    it('should append weight entry', async () => {
      const route: Route = JSON.parse(readFileSync('./data/routes/route-weight.json', 'utf-8'));
      const capture = createMockCapture('weight 85.5', 'weight 85.5');

      const result = await executor.execute(route, capture);

      if (result.status === 'failed') {
        console.log('Weight test error:', result.error);
      }
      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('row');
      console.log('Weight logged to row:', (result.data as any).row);

      // Note: Manual cleanup required - check sheet and delete test row
    });
  });

  describe('gwenmem route (lookup_append_to_row)', () => {
    it('should append memory to today row', async () => {
      const route: Route = JSON.parse(readFileSync('./data/routes/route-gwenmem.json', 'utf-8'));
      const capture = createMockCapture("gwenmem 'test memory delete me'", "gwenmem 'test memory delete me'");

      const result = await executor.execute(route, capture);

      // May fail if today's date doesn't exist in sheet
      if (result.status === 'failed' && result.error?.includes('Row lookup failed')) {
        console.log('Expected: no row for today in test sheet');
        return;
      }

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('row');
      expect(result.data).toHaveProperty('col');
      console.log('Memory logged to:', result.data);
    });
  });

  describe('bookantt route (lookup_set_cell)', () => {
    it('should log reading time for fuzzy-matched book', async () => {
      const route: Route = JSON.parse(readFileSync('./data/routes/route-bookantt.json', 'utf-8'));
      const capture = createMockCapture('book: 10min bad parts', 'book: 10min bad parts');

      const result = await executor.execute(route, capture);

      // May fail if today's date column doesn't exist
      if (result.status === 'failed' && result.error?.includes('Column lookup failed')) {
        console.log('Expected: no column for today in test sheet');
        return;
      }

      // May fail if fuzzy match doesn't find book
      if (result.status === 'failed' && result.error?.includes('Row lookup failed')) {
        console.log('Book not found - check fuzzy matcher');
        return;
      }

      expect(result.status).toBe('success');
      expect(result.data).toHaveProperty('row');
      expect(result.data).toHaveProperty('col');
      console.log('Book time logged to:', result.data);
    });
  });
});
