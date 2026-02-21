import { google } from 'googleapis';
import { readFileSync } from 'fs';

const SHEET_ID = process.argv[2] || '1pYyHCN1osYQXoz8Qf9gjGZGP5ifhQfY_bv-c316tp4o';

async function main() {
  const creds = JSON.parse(readFileSync('./secrets/google-secrets.json', 'utf-8'));
  const tokens = JSON.parse(readFileSync('./secrets/google-tokens.json', 'utf-8'));

  const { client_id, client_secret } = creds.installed;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(tokens);

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  // Get spreadsheet metadata
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    includeGridData: false,
  });

  console.log('=== SPREADSHEET ===');
  console.log('Title:', meta.data.properties?.title);
  console.log('\n=== SHEETS ===');
  for (const sheet of meta.data.sheets || []) {
    console.log(`- ${sheet.properties?.title} (${sheet.properties?.gridProperties?.rowCount} rows x ${sheet.properties?.gridProperties?.columnCount} cols)`);
  }

  // Inspect all sheets
  for (const sheetMeta of meta.data.sheets || []) {
    const sheetName = sheetMeta.properties?.title;
    if (!sheetName) continue;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`=== DATA FROM "${sheetName}" (first 25 rows x 30 cols) ===`);
    console.log('='.repeat(60));

    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${sheetName}'!A1:AD25`,
    });

    const rows = data.data.values || [];

    // Print column headers (A, B, C, etc.)
    const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => 'A' + l)
    );
    console.log('     ' + colLetters.slice(0, 30).map(l => l.padEnd(12)).join(''));
    console.log('-'.repeat(380));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const formatted = [];
      for (let j = 0; j < 30; j++) {
        const val = String(row[j] ?? '').slice(0, 11).padEnd(12);
        formatted.push(val);
      }
      console.log(`R${String(i + 1).padStart(2)}: ${formatted.join('')}`);
    }
  }
}

main().catch(console.error);
