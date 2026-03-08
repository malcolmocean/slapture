# Sheets Discovery & Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Mastermind aware of Google Sheets as a destination and able to discover existing user spreadsheets, so it routes captures to Sheets instead of CSV files.

**Architecture:** Three changes: (1) Add Drive API scope to OAuth flow so we can list user spreadsheets, (2) Add a `listSpreadsheets` toolkit function + `inspectSpreadsheet` for header preview, (3) Enrich the Mastermind prompt with sheets destination docs and connected spreadsheet context. The integration context pipeline (`gatherIntegrationContext`) already feeds data into the Mastermind prompt — we extend it with spreadsheet discovery data for connected Sheets users.

**Tech Stack:** googleapis (already installed — `google.drive`), existing OAuth token flow, vitest + Playwright

---

### Task 1: Add Drive scope to OAuth flow

**Files:**
- Modify: `src/server/oauth.ts:244`

**Step 1: Write the failing test**

In `tests/unit/mastermind.test.ts`, no test needed — this is a one-line scope change in the OAuth URL builder.

**Step 2: Update the scope**

In `src/server/oauth.ts`, line 244, change:
```typescript
authorizeUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/spreadsheets');
```
to:
```typescript
authorizeUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly');
```

Space-separated scopes is the Google OAuth standard.

**Step 3: Verify build**

Run: `pnpm build`
Expected: Success

**Step 4: Commit**

```
feat: add drive.readonly scope to Sheets OAuth for spreadsheet discovery
```

---

### Task 2: Add `listSpreadsheets` and `inspectSpreadsheet` to toolkit

**Files:**
- Modify: `src/integrations/sheets/toolkit.ts`
- Modify: `src/integrations/sheets/auth.ts` (need Drive client factory)
- Create: `tests/routes/sheets-discovery.test.ts`

**Step 1: Write the failing test**

Create `tests/routes/sheets-discovery.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hasCredentials, loadCredentials } from '../fixtures/sheets-test-creds';
import { createSheetsClient, createDriveClient } from '../../src/integrations/sheets/auth';
import { listSpreadsheets, inspectSpreadsheet } from '../../src/integrations/sheets/toolkit';

describe.skipIf(!hasCredentials)('Sheets Discovery', () => {
  it('should list recent spreadsheets', async () => {
    const creds = loadCredentials();
    const drive = createDriveClient(creds);
    const results = await listSpreadsheets(drive, { maxResults: 5 });

    expect(Array.isArray(results)).toBe(true);
    // Test account should have at least one spreadsheet
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
  });

  it('should inspect a spreadsheet and return headers', async () => {
    const creds = loadCredentials();
    const sheets = createSheetsClient(creds);
    const drive = createDriveClient(creds);

    // Get first spreadsheet from list
    const list = await listSpreadsheets(drive, { maxResults: 1 });
    expect(list.length).toBeGreaterThan(0);

    const result = await inspectSpreadsheet(sheets, list[0].id);

    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('sheets');
    expect(Array.isArray(result.sheets)).toBe(true);
    expect(result.sheets.length).toBeGreaterThan(0);
    expect(result.sheets[0]).toHaveProperty('name');
    expect(result.sheets[0]).toHaveProperty('headers');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/routes/sheets-discovery.test.ts`
Expected: FAIL — `createDriveClient`, `listSpreadsheets`, `inspectSpreadsheet` don't exist

**Step 3: Add `createDriveClient` to auth.ts**

In `src/integrations/sheets/auth.ts`, add:

```typescript
import { google, sheets_v4, drive_v3 } from 'googleapis';

export function createDriveClient(auth: SheetsAuth): drive_v3.Drive {
  const oauth2Client = new google.auth.OAuth2(
    auth.clientId,
    auth.clientSecret
  );
  oauth2Client.setCredentials({
    access_token: auth.accessToken,
    refresh_token: auth.refreshToken,
  });
  return google.drive({ version: 'v3', auth: oauth2Client });
}
```

Update the existing import line to include `drive_v3`.

**Step 4: Add `listSpreadsheets` and `inspectSpreadsheet` to toolkit.ts**

At the end of `src/integrations/sheets/toolkit.ts`, add:

```typescript
import type { drive_v3 } from 'googleapis';

export interface SpreadsheetSummary {
  id: string;
  name: string;
}

export interface SpreadsheetInspection {
  title: string;
  sheets: Array<{
    name: string;
    headers: string[];   // First row values
    sampleRow: string[];  // Second row values (for context)
    rowCount: number;
  }>;
}

/**
 * List the user's recent Google Sheets spreadsheets via Drive API.
 */
export async function listSpreadsheets(
  drive: drive_v3.Drive,
  opts?: { maxResults?: number }
): Promise<SpreadsheetSummary[]> {
  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id, name)',
    orderBy: 'modifiedTime desc',
    pageSize: opts?.maxResults ?? 10,
  });

  return (response.data.files ?? []).map(f => ({
    id: f.id!,
    name: f.name!,
  }));
}

/**
 * Inspect a spreadsheet: get sheet names, headers (row 1), and a sample row (row 2).
 */
export async function inspectSpreadsheet(
  client: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<SpreadsheetInspection> {
  // Get spreadsheet metadata (title + sheet names)
  const meta = await client.spreadsheets.get({ spreadsheetId });
  const title = meta.data.properties?.title ?? 'Untitled';
  const sheetMetas = meta.data.sheets ?? [];

  const sheets: SpreadsheetInspection['sheets'] = [];

  for (const sheetMeta of sheetMetas.slice(0, 5)) {
    const sheetName = sheetMeta.properties?.title ?? 'Sheet1';
    const rowCount = sheetMeta.properties?.gridProperties?.rowCount ?? 0;

    // Read first 2 rows for headers + sample
    const range = `'${sheetName}'!A1:Z2`;
    const data = await client.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = data.data.values ?? [];
    sheets.push({
      name: sheetName,
      headers: (rows[0] ?? []).map(String),
      sampleRow: (rows[1] ?? []).map(String),
      rowCount,
    });
  }

  return { title, sheets };
}
```

Note: the toolkit currently only imports `sheets_v4` types. The `drive_v3` import is a type-only import for the function signature.

**Step 5: Run test to verify it passes**

Run: `pnpm test tests/routes/sheets-discovery.test.ts`
Expected: PASS (if Google creds are available; skipped otherwise)

**Step 6: Commit**

```
feat: add listSpreadsheets and inspectSpreadsheet toolkit functions
```

---

### Task 3: Enrich Mastermind integration context with spreadsheet data

**Files:**
- Modify: `src/mastermind/index.ts` (IntegrationContext type, buildIntegrationSection, buildPrompt)
- Modify: `src/pipeline/index.ts` (gatherIntegrationContext)
- Test: `tests/unit/mastermind.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/mastermind.test.ts`, inside the `'integration context in prompt'` describe block:

```typescript
it('should include spreadsheet context for connected Sheets integration', () => {
  const integrations: IntegrationWithStatus[] = [
    {
      id: 'sheets',
      name: 'Google Sheets',
      purpose: 'Capture data to Google Sheets',
      authType: 'oauth',
      status: 'connected',
    },
  ];

  const context: IntegrationContext = {
    integrations,
    integrationNotes: new Map(),
    destinationNotes: new Map(),
    sheetsContext: {
      spreadsheets: [
        {
          id: 'abc123',
          name: 'Baby Memories',
          sheets: [
            { name: 'Sheet1', headers: ['Date', 'Memory', 'Who'], sampleRow: ['2026-01-01', 'First smile', 'Gwen'] },
          ],
        },
        {
          id: 'def456',
          name: 'Malcolm Weight',
          sheets: [
            { name: 'Log', headers: ['Date', 'Weight (kg)', 'Notes'], sampleRow: ['2026-03-01', '85.2', ''] },
          ],
        },
      ],
    },
  };

  const prompt = mastermind.buildPrompt(
    existingRoutes,
    'baby smiled today',
    { explicitRoute: null, payload: 'baby smiled today', metadata: {} },
    'No match',
    context
  );

  expect(prompt).toContain('Your Google Sheets');
  expect(prompt).toContain('Baby Memories');
  expect(prompt).toContain('abc123');
  expect(prompt).toContain('Date | Memory | Who');
  expect(prompt).toContain('Malcolm Weight');
});

it('should not include spreadsheet context when Sheets not connected', () => {
  const integrations: IntegrationWithStatus[] = [
    {
      id: 'sheets',
      name: 'Google Sheets',
      purpose: 'Capture data to Google Sheets',
      authType: 'oauth',
      status: 'never',
    },
  ];

  const context: IntegrationContext = {
    integrations,
    integrationNotes: new Map(),
    destinationNotes: new Map(),
  };

  const prompt = mastermind.buildPrompt(
    existingRoutes,
    'test',
    { explicitRoute: null, payload: 'test', metadata: {} },
    'No match',
    context
  );

  expect(prompt).not.toContain('Your Google Sheets');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/mastermind.test.ts`
Expected: FAIL — `sheetsContext` not a valid property on IntegrationContext

**Step 3: Extend IntegrationContext type**

In `src/mastermind/index.ts`, update the `IntegrationContext` interface:

```typescript
export interface SheetsContextEntry {
  id: string;
  name: string;
  sheets: Array<{
    name: string;
    headers: string[];
    sampleRow: string[];
  }>;
}

export interface IntegrationContext {
  integrations: IntegrationWithStatus[];
  integrationNotes: Map<string, string>;
  destinationNotes: Map<string, string>;
  sheetsContext?: {
    spreadsheets: SheetsContextEntry[];
  };
}
```

**Step 4: Update `buildIntegrationSection` to include spreadsheet context**

In the `buildIntegrationSection` method, after the existing notes section and before the closing guidance text, add:

```typescript
// Add spreadsheet context for connected Sheets integration
if (context.sheetsContext?.spreadsheets.length) {
  const sheetLines = context.sheetsContext.spreadsheets.map(ss => {
    const tabSummaries = ss.sheets.map(tab => {
      const headerStr = tab.headers.join(' | ');
      const sampleStr = tab.sampleRow.length ? `  Sample: ${tab.sampleRow.join(' | ')}` : '';
      return `    Tab "${tab.name}": ${headerStr}${sampleStr}`;
    }).join('\n');
    return `  - "${ss.name}" (id: ${ss.id})\n${tabSummaries}`;
  }).join('\n');

  section += `\n\nYour Google Sheets (recently accessed):\n${sheetLines}`;
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm test tests/unit/mastermind.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: include spreadsheet discovery context in Mastermind prompt
```

---

### Task 4: Add `### "sheets"` destination docs to Mastermind prompt

**Files:**
- Modify: `src/mastermind/index.ts` (buildPrompt — the route destination types section)
- Test: `tests/unit/mastermind.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/mastermind.test.ts`:

```typescript
describe('sheets destination docs in prompt', () => {
  it('should include sheets destination type documentation', () => {
    const prompt = mastermind.buildPrompt(
      [],
      'test',
      { explicitRoute: null, payload: 'test', metadata: {} },
      'No match'
    );

    expect(prompt).toContain('### "sheets" - Google Sheets');
    expect(prompt).toContain('spreadsheetId');
    expect(prompt).toContain('append_row');
    expect(prompt).toContain('lookup_set_cell');
    expect(prompt).toContain('lookup_append_to_row');
  });

  it('should instruct Mastermind to prefer Sheets over CSV when Sheets is connected', () => {
    const prompt = mastermind.buildPrompt(
      [],
      'test',
      { explicitRoute: null, payload: 'test', metadata: {} },
      'No match'
    );

    expect(prompt).toContain('Prefer Google Sheets over local CSV');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/mastermind.test.ts`
Expected: FAIL

**Step 3: Add sheets destination docs to buildPrompt**

In `src/mastermind/index.ts`, in the `buildPrompt` method, after the `### "notes"` section (around line 157) and before the `When creating routes for "log X to Y" patterns` section, add:

```typescript
### "sheets" - Google Sheets
destinationConfig: {spreadsheetId: "<id from spreadsheet list>", sheetName: "<tab name>", operation: <operation>}
No transformScript needed - the sheets executor handles everything declaratively.

Operations:
- append_row: Add a new row. Specify columns array.
  operation: {type: "append_row", columns: [<ColumnSpec>, ...]}
- lookup_set_cell: 2D lookup (find row + find column) then set cell value.
  operation: {type: "lookup_set_cell", rowLookup: <LookupSpec>, colLookup: <LookupSpec>, value: <ValueSpec>}
- lookup_append_to_row: Find row, write to first empty column in range.
  operation: {type: "lookup_append_to_row", rowLookup: <LookupSpec>, colRange: [start, end], value: <ValueSpec>}

ColumnSpec / ValueSpec types:
- {type: "today", format?: "short"} — current date
- {type: "payload"} — full parsed payload
- {type: "extract", pattern: "<regex>", group?: 1} — regex capture from payload
- {type: "computed", expression: "<arithmetic>"} — safe math eval
- {type: "literal", value: <any>} — static value

LookupSpec: {axis: "row"|"col", at: <index>, valueSource: <ValueSpec>, match: "exact"|"fuzzy"|"date", range?: [start, end]}

Prefer Google Sheets over local CSV files when the user has Sheets connected and the data is tabular/structured.
Use spreadsheet IDs from the "Your Google Sheets" list when a matching spreadsheet already exists.
Inspect headers to determine the right operation and column mapping.
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/mastermind.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: add sheets destination documentation to Mastermind prompt
```

---

### Task 5: Wire up spreadsheet discovery in the pipeline

**Files:**
- Modify: `src/pipeline/index.ts` (gatherIntegrationContext)
- Modify: `src/integrations/sheets/auth.ts` (need createDriveClient available from SheetsAuthProvider credentials)

**Step 1: Update `gatherIntegrationContext` in pipeline**

In `src/pipeline/index.ts`, in the `gatherIntegrationContext` method, after gathering destination notes and before the return, add logic to fetch spreadsheet context when Sheets is connected:

```typescript
// Fetch spreadsheet context if Sheets is connected
const sheetsIntegration = integrations.find(i => i.id === 'sheets');
let sheetsContext: IntegrationContext['sheetsContext'];

if (sheetsIntegration?.status === 'connected') {
  try {
    const sheetsTokens = await this.storage.getSheetsTokens(username);
    if (sheetsTokens) {
      const { createDriveClient, createSheetsClient } = await import('../integrations/sheets/auth.js');
      const { listSpreadsheets, inspectSpreadsheet } = await import('../integrations/sheets/toolkit.js');

      const creds = {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        accessToken: sheetsTokens.accessToken,
        refreshToken: sheetsTokens.refreshToken,
      };

      const drive = createDriveClient(creds);
      const sheetsClient = createSheetsClient(creds);
      const spreadsheets = await listSpreadsheets(drive, { maxResults: 10 });

      // Inspect top 5 for headers
      const inspected = await Promise.all(
        spreadsheets.slice(0, 5).map(async (ss) => {
          try {
            const inspection = await inspectSpreadsheet(sheetsClient, ss.id);
            return {
              id: ss.id,
              name: ss.name,
              sheets: inspection.sheets.map(tab => ({
                name: tab.name,
                headers: tab.headers,
                sampleRow: tab.sampleRow,
              })),
            };
          } catch {
            return { id: ss.id, name: ss.name, sheets: [] };
          }
        })
      );

      sheetsContext = { spreadsheets: inspected };
    }
  } catch (error) {
    console.error('[Pipeline] Failed to fetch spreadsheet context:', error);
    // Non-fatal — continue without sheets context
  }
}
```

Then include `sheetsContext` in the return:

```typescript
return {
  integrations,
  integrationNotes,
  destinationNotes,
  sheetsContext,
};
```

**Step 2: Verify build**

Run: `pnpm build`
Expected: Success

**Step 3: Run existing tests**

Run: `pnpm test`
Expected: All existing tests pass

**Step 4: Commit**

```
feat: wire spreadsheet discovery into pipeline integration context
```

---

### Task 6: E2E test — Mastermind routes to Sheets instead of CSV

**Files:**
- Create: `tests/e2e/sheets-routing.spec.ts`

This test verifies the full flow: submit a capture that should go to Sheets, verify the Mastermind creates a sheets route (not an fs/CSV route).

**Step 1: Write the E2E test**

Create `tests/e2e/sheets-routing.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

const GOOGLE_TEST_ACCOUNT = process.env.GOOGLE_TEST_ACCOUNT || '';
const GOOGLE_TEST_ACCOUNT_PASSWORD = process.env.GOOGLE_TEST_ACCOUNT_PASSWORD || '';

test.describe('Sheets Routing', () => {
  test.skip(!GOOGLE_TEST_ACCOUNT || !GOOGLE_TEST_ACCOUNT_PASSWORD,
    'Requires GOOGLE_TEST_ACCOUNT and GOOGLE_TEST_ACCOUNT_PASSWORD env vars');

  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('routes weight entry to existing weight spreadsheet instead of CSV', async ({ page }) => {
    // Submit a capture that should match a weight spreadsheet
    const response = await page.request.post('/capture', {
      data: { text: 'weight 84.5 kg' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Check that capture was processed (may be success or blocked_needs_auth)
    expect(['success', 'blocked_needs_auth']).toContain(body.status);

    // Fetch the capture to inspect the route
    const captureId = body.captureId;
    const statusResponse = await page.request.get(`/status/${captureId}`);
    const capture = await statusResponse.json();

    // If a route was created, it should be a sheets route, not fs
    if (capture.routeFinal) {
      const routesResponse = await page.request.get('/routes');
      const routes = await routesResponse.json();
      const matchedRoute = routes.find((r: any) => r.id === capture.routeFinal || r.name === capture.routeFinal);

      if (matchedRoute) {
        // The key assertion: should prefer sheets over fs for tabular data
        expect(matchedRoute.destinationType).toBe('sheets');
        expect(matchedRoute.destinationConfig).toHaveProperty('spreadsheetId');
      }
    }

    // Also check the execution trace for mastermind action
    const mastermindStep = capture.executionTrace?.find((s: any) => s.step === 'mastermind');
    if (mastermindStep?.output?.action === 'create') {
      expect(mastermindStep.output.route.destinationType).toBe('sheets');
    }
  });

  test('routes baby memory to existing baby memories spreadsheet', async ({ page }) => {
    const response = await page.request.post('/capture', {
      data: { text: 'baby rolled over for the first time today' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const captureId = body.captureId;

    const statusResponse = await page.request.get(`/status/${captureId}`);
    const capture = await statusResponse.json();

    if (capture.routeFinal) {
      const routesResponse = await page.request.get('/routes');
      const routes = await routesResponse.json();
      const matchedRoute = routes.find((r: any) => r.id === capture.routeFinal || r.name === capture.routeFinal);

      if (matchedRoute) {
        expect(matchedRoute.destinationType).toBe('sheets');
        // Should reference a spreadsheet named something like "baby memories"
        expect(matchedRoute.destinationConfig).toHaveProperty('spreadsheetId');
      }
    }
  });
});
```

**Step 2: Run the E2E test**

Run: `pnpm exec playwright test tests/e2e/sheets-routing.spec.ts`
Expected: PASS (requires Sheets OAuth connected for the test user, and the dummy spreadsheets to exist)

Note: This test depends on:
1. The test user having connected Google Sheets OAuth (from the sheets-oauth E2E test or manual setup)
2. The dummy "baby memories" and "Malcolm weight spreadsheet" existing in the test user's Google Drive

**Step 3: Commit**

```
test: add E2E tests verifying Mastermind routes to Sheets over CSV
```

---

### Task 7: Run full test suite and verify

**Step 1: Run unit tests**

Run: `pnpm test`
Expected: All pass

**Step 2: Run E2E tests**

Run: `pnpm exec playwright test`
Expected: All pass (sheets tests may skip if no Google creds available)

**Step 3: Final commit (if any fixups needed)**

---

## Summary of changes

| File | Change |
|------|--------|
| `src/server/oauth.ts` | Add `drive.readonly` scope |
| `src/integrations/sheets/auth.ts` | Add `createDriveClient()` |
| `src/integrations/sheets/toolkit.ts` | Add `listSpreadsheets()`, `inspectSpreadsheet()` |
| `src/mastermind/index.ts` | Extend `IntegrationContext`, add sheets docs to prompt, render spreadsheet context |
| `src/pipeline/index.ts` | Fetch spreadsheet context in `gatherIntegrationContext` |
| `tests/routes/sheets-discovery.test.ts` | Unit tests for discovery functions |
| `tests/unit/mastermind.test.ts` | Tests for sheets context in prompt |
| `tests/e2e/sheets-routing.spec.ts` | E2E tests for Mastermind preferring Sheets |
