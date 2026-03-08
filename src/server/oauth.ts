// src/server/oauth.ts
import type { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';

export interface OAuthConfig {
  intendClientId?: string;
  intendClientSecret?: string;
  intendBaseUrl: string;
  callbackBaseUrl: string;
  sheetsClientId?: string;
  sheetsClientSecret?: string;
}

interface DynamicClientCredentials {
  client_id: string;
  client_secret: string;
}

let dynamicClientCache: DynamicClientCredentials | null = null;

async function getOrRegisterClient(config: OAuthConfig): Promise<DynamicClientCredentials> {
  if (config.intendClientId && config.intendClientSecret) {
    return {
      client_id: config.intendClientId,
      client_secret: config.intendClientSecret
    };
  }

  if (dynamicClientCache) {
    return dynamicClientCache;
  }

  console.log('[OAuth] Registering dynamic OAuth client with intend.do');
  const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;

  const registerResponse = await fetch(`${config.intendBaseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Slapture Capture System',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp:tools'
    })
  });

  if (!registerResponse.ok) {
    const errorText = await registerResponse.text();
    throw new Error(`Dynamic client registration failed: ${registerResponse.status} ${errorText}`);
  }

  const clientData = await registerResponse.json() as DynamicClientCredentials;
  console.log('[OAuth] Successfully registered dynamic client:', clientData.client_id);

  dynamicClientCache = clientData;
  return clientData;
}

function generateCsrf(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function encodeState(user: string, csrf: string): string {
  return Buffer.from(JSON.stringify({ user, csrf })).toString('base64');
}

interface DecodeStateResult {
  user?: string;
  csrf?: string;
  error?: 'invalid_state' | 'missing_user';
}

function decodeState(state: string): DecodeStateResult {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    if (typeof decoded.user !== 'string' || !decoded.user) {
      return { error: 'missing_user' };
    }
    return { user: decoded.user, csrf: decoded.csrf };
  } catch {
    return { error: 'invalid_state' };
  }
}

export function buildOAuthRoutes(
  app: Hono,
  storage: StorageInterface,
  config: OAuthConfig
): void {

  app.get('/connect/intend', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    const user = auth.uid;

    try {
      const credentials = await getOrRegisterClient(config);
      const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;
      const authorizeUrl = new URL(`${config.intendBaseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', credentials.client_id);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', 'mcp:tools');

      const csrf = generateCsrf();
      const state = encodeState(user, csrf);
      authorizeUrl.searchParams.set('state', state);

      return c.redirect(authorizeUrl.toString());
    } catch (error) {
      console.error('[OAuth] Failed to initiate OAuth flow:', error);
      const detail = encodeURIComponent(error instanceof Error ? error.message : String(error));
      return c.redirect(`/oauth/error?reason=registration_failed&detail=${detail}`);
    }
  });

  app.get('/oauth/callback/intend', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (!code) {
      return c.json({ error: 'Missing authorization code' }, 400);
    }

    if (!state) {
      return c.json({ error: 'Missing state parameter' }, 400);
    }

    const decodedState = decodeState(state);
    if (decodedState.error === 'invalid_state') {
      return c.json({ error: 'Invalid state parameter' }, 400);
    }
    if (decodedState.error === 'missing_user' || !decodedState.user) {
      return c.json({ error: 'Missing user in state parameter' }, 400);
    }

    const { user } = decodedState;

    try {
      const credentials = await getOrRegisterClient(config);
      const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;
      const tokenResponse = await fetch(`${config.intendBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: credentials.client_id,
          client_secret: credentials.client_secret
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[OAuth] Token exchange failed:', tokenResponse.status, errorText);
        const detail = encodeURIComponent(`${tokenResponse.status}: ${errorText}`);
        return c.redirect(`/oauth/error?reason=token_exchange_failed&detail=${detail}`);
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      await storage.saveIntendTokens(user, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        baseUrl: config.intendBaseUrl
      });

      console.log(`[OAuth] intend.do connected successfully for user: ${user}`);
      return c.redirect('/dashboard/auth');
    } catch (error) {
      console.error('[OAuth] Error during token exchange:', error);
      const detail = encodeURIComponent(error instanceof Error ? error.message : String(error));
      return c.redirect(`/oauth/error?reason=internal_error&detail=${detail}`);
    }
  });

  app.get('/auth/status/intend', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    const user = auth.uid;

    const tokens = await storage.getIntendTokens(user);
    const connected = tokens !== null;
    const expired = connected && new Date(tokens.expiresAt) < new Date();
    const blockedCaptures = await storage.listCapturesNeedingAuth();

    return c.json({
      connected,
      expired,
      blockedCaptureCount: blockedCaptures.filter(c =>
        c.routeFinal && c.routeFinal.includes('intend')
      ).length
    });
  });

  app.post('/disconnect/intend', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    const user = auth.uid;

    await storage.clearIntendTokens(user);
    console.log(`[OAuth] intend.do disconnected for user: ${user}`);

    const redirect = c.req.query('redirect');
    if (redirect) {
      return c.redirect(redirect);
    }
    return c.json({ success: true });
  });

  // --- Google Sheets OAuth ---

  app.get('/connect/sheets', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    if (!config.sheetsClientId || !config.sheetsClientSecret) {
      return c.json({ error: 'Google Sheets OAuth not configured' }, 500);
    }

    const user = auth.uid;
    const redirectUri = `${config.callbackBaseUrl}/oauth/callback/sheets`;
    const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizeUrl.searchParams.set('client_id', config.sheetsClientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly');
    authorizeUrl.searchParams.set('access_type', 'offline');
    authorizeUrl.searchParams.set('prompt', 'consent');

    const csrf = generateCsrf();
    const state = encodeState(user, csrf);
    authorizeUrl.searchParams.set('state', state);

    return c.redirect(authorizeUrl.toString());
  });

  app.get('/oauth/callback/sheets', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      const detail = encodeURIComponent(c.req.query('error_description') || error);
      return c.redirect(`/oauth/error?reason=google_denied&detail=${detail}`);
    }

    if (!code) {
      return c.json({ error: 'Missing authorization code' }, 400);
    }

    if (!state) {
      return c.json({ error: 'Missing state parameter' }, 400);
    }

    const decodedState = decodeState(state);
    if (decodedState.error === 'invalid_state') {
      return c.json({ error: 'Invalid state parameter' }, 400);
    }
    if (decodedState.error === 'missing_user' || !decodedState.user) {
      return c.json({ error: 'Missing user in state parameter' }, 400);
    }

    const { user } = decodedState;

    try {
      const redirectUri = `${config.callbackBaseUrl}/oauth/callback/sheets`;
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: config.sheetsClientId!,
          client_secret: config.sheetsClientSecret!,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[OAuth/Sheets] Token exchange failed:', tokenResponse.status, errorText);
        const detail = encodeURIComponent(`${tokenResponse.status}: ${errorText}`);
        return c.redirect(`/oauth/error?reason=token_exchange_failed&detail=${detail}`);
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
      };

      await storage.saveSheetsTokens(user, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

      console.log(`[OAuth/Sheets] Google Sheets connected successfully for user: ${user}`);
      return c.redirect('/dashboard/auth');
    } catch (err) {
      console.error('[OAuth/Sheets] Error during token exchange:', err);
      const detail = encodeURIComponent(err instanceof Error ? err.message : String(err));
      return c.redirect(`/oauth/error?reason=internal_error&detail=${detail}`);
    }
  });

  app.get('/auth/status/sheets', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    const user = auth.uid;

    const tokens = await storage.getSheetsTokens(user);
    const connected = tokens !== null;
    const blockedCaptures = await storage.listCapturesNeedingAuth(user);

    return c.json({
      connected,
      blockedCaptureCount: blockedCaptures.filter(c =>
        c.routeFinal && c.routeFinal.includes('sheets')
      ).length,
    });
  });

  app.post('/disconnect/sheets', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    const user = auth.uid;

    await storage.clearSheetsTokens(user);
    console.log(`[OAuth/Sheets] Google Sheets disconnected for user: ${user}`);

    const redirect = c.req.query('redirect');
    if (redirect) {
      return c.redirect(redirect);
    }
    return c.json({ success: true });
  });

  // --- Shared OAuth pages ---

  app.get('/oauth/success', async (c) => {
    const integration = c.req.query('integration');
    return c.html(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Connected to ${integration || 'integration'}</h1>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  });

  app.get('/oauth/error', async (c) => {
    const reason = c.req.query('reason');
    const detail = c.req.query('detail');
    return c.html(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Connection Failed</h1>
          <p>Reason: ${reason || 'unknown'}</p>
          ${detail ? `<pre style="text-align: left; background: #f5f5f5; padding: 16px; border-radius: 8px; max-width: 600px; margin: 16px auto; overflow-x: auto; white-space: pre-wrap;">${detail}</pre>` : ''}
          <p><a href="/connect/intend">Try again</a></p>
        </body>
      </html>
    `);
  });
}
