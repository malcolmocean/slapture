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
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    console.log('Found spreadsheets:', results.map(r => r.name));
  });

  it('should inspect a spreadsheet and return headers', async () => {
    const creds = loadCredentials();
    const sheets = createSheetsClient(creds);
    const drive = createDriveClient(creds);

    const list = await listSpreadsheets(drive, { maxResults: 1 });
    expect(list.length).toBeGreaterThan(0);

    const result = await inspectSpreadsheet(sheets, list[0].id);

    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('sheets');
    expect(Array.isArray(result.sheets)).toBe(true);
    expect(result.sheets.length).toBeGreaterThan(0);
    expect(result.sheets[0]).toHaveProperty('name');
    expect(result.sheets[0]).toHaveProperty('headers');
    console.log('Inspected:', result.title, result.sheets.map(s => `${s.name}: [${s.headers.join(', ')}]`));
  });
});
