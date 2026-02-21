import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { exec } from 'child_process';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}`;

// --test flag: save to fixtures/ (committable, short-lived test creds)
// default: save to secrets/ (gitignored, personal creds)
const isTestMode = process.argv.includes('--test');

async function main() {
  const credsPath = './secrets/google-secrets.json';
  const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
  const { client_id, client_secret } = creds.installed;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    REDIRECT_URI
  );

  if (isTestMode) {
    console.log('=== TEST CREDENTIAL MODE ===');
    console.log('Tokens will be saved to tests/fixtures/google-test-tokens.json');
    console.log('These are committable — they use a test account and expire within a week.');
    console.log('Sign in with the TEST account, not your personal one.\n');
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('Opening browser for Google OAuth...\n');
  console.log('If browser doesn\'t open, visit:\n');
  console.log(authUrl);
  console.log('\n');

  const openCmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${authUrl}"`);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');

    if (code) {
      try {
        const { tokens } = await oauth2Client.getToken(code);

        let tokensPath: string;
        if (isTestMode) {
          mkdirSync('tests/fixtures', { recursive: true });
          tokensPath = 'tests/fixtures/google-test-tokens.json';
        } else {
          tokensPath = './secrets/google-tokens.json';
        }

        writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));

        console.log('✓ Tokens saved to', tokensPath);
        console.log('\nToken details:');
        console.log('  access_token:', tokens.access_token?.slice(0, 20) + '...');
        console.log('  refresh_token:', tokens.refresh_token ? 'present' : 'missing');
        console.log('  expiry_date:', tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'none');

        if (isTestMode) {
          console.log('\nRemember: these expire within ~7 days (Google "testing" app policy).');
          console.log('Re-run `pnpm tsx scripts/google-oauth.ts --test` to refresh.');
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>${isTestMode ? 'Test Creds Saved!' : 'Success!'}</h1>
              <p>OAuth tokens saved to ${tokensPath}. You can close this tab.</p>
            </body>
          </html>
        `);

        server.close();
        process.exit(0);
      } catch (err) {
        console.error('Token exchange failed:', err);
        res.writeHead(500);
        res.end('Token exchange failed');
        server.close();
        process.exit(1);
      }
    } else {
      res.writeHead(400);
      res.end('No code in callback');
    }
  });

  server.listen(PORT, () => {
    console.log(`Waiting for OAuth callback on port ${PORT}...`);
  });
}

main().catch(console.error);
