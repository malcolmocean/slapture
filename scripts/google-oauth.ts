import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}`;

async function main() {
  // Load client credentials
  const credsPath = './secrets/google-secrets.json';
  const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
  const { client_id, client_secret } = creds.installed;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    REDIRECT_URI
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh_token
  });

  console.log('Opening browser for Google OAuth...\n');
  console.log('If browser doesn\'t open, visit:\n');
  console.log(authUrl);
  console.log('\n');

  // Open browser
  const openCmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${authUrl}"`);

  // Start local server to catch callback
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');

    if (code) {
      try {
        const { tokens } = await oauth2Client.getToken(code);

        // Save tokens
        const tokensPath = './secrets/google-tokens.json';
        writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));

        console.log('✓ Tokens saved to', tokensPath);
        console.log('\nToken details:');
        console.log('  access_token:', tokens.access_token?.slice(0, 20) + '...');
        console.log('  refresh_token:', tokens.refresh_token ? 'present' : 'missing');
        console.log('  expiry_date:', tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'none');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>🐬 Success!</h1>
              <p>OAuth tokens saved. You can close this tab.</p>
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
