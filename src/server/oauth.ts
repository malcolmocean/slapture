import type { FastifyInstance } from 'fastify';
import type { Storage } from '../storage/index.js';

export interface OAuthConfig {
  intendClientId?: string;
  intendClientSecret?: string;
  intendBaseUrl: string;
  callbackBaseUrl: string;
}

interface DynamicClientCredentials {
  client_id: string;
  client_secret: string;
}

// Cache for dynamically registered client credentials
let dynamicClientCache: DynamicClientCredentials | null = null;

async function getOrRegisterClient(config: OAuthConfig): Promise<DynamicClientCredentials> {
  // If static credentials provided, use them
  if (config.intendClientId && config.intendClientSecret) {
    return {
      client_id: config.intendClientId,
      client_secret: config.intendClientSecret
    };
  }

  // If we have cached dynamic credentials, use them
  if (dynamicClientCache) {
    return dynamicClientCache;
  }

  // Dynamically register the client
  console.log('[OAuth] Registering dynamic OAuth client with intend.do');
  const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;

  const registerResponse = await fetch(`${config.intendBaseUrl}/oauth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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

// Helper to generate CSRF token
function generateCsrf(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Helper to encode state parameter with user and CSRF token
function encodeState(user: string, csrf: string): string {
  return Buffer.from(JSON.stringify({ user, csrf })).toString('base64');
}

// Helper to decode state parameter
// Returns { user, csrf, error } where error is set if decoding fails
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
  app: FastifyInstance,
  storage: Storage,
  config: OAuthConfig
): void {

  // Initiate OAuth flow
  app.get('/connect/intend', async (request, reply) => {
    const { user } = request.query as { user?: string };

    if (!user) {
      return reply.status(400).send({ error: 'Missing required user parameter' });
    }

    try {
      const credentials = await getOrRegisterClient(config);
      const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;
      const authorizeUrl = new URL(`${config.intendBaseUrl}/oauth/authorize`);
      authorizeUrl.searchParams.set('client_id', credentials.client_id);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', 'mcp:tools');

      // Encode user in state parameter with CSRF token
      const csrf = generateCsrf();
      const state = encodeState(user, csrf);
      authorizeUrl.searchParams.set('state', state);

      return reply.redirect(authorizeUrl.toString());
    } catch (error) {
      console.error('[OAuth] Failed to initiate OAuth flow:', error);
      return reply.redirect('/oauth/error?reason=registration_failed');
    }
  });

  // OAuth callback
  app.get('/oauth/callback/intend', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code) {
      return reply.status(400).send({ error: 'Missing authorization code' });
    }

    if (!state) {
      return reply.status(400).send({ error: 'Missing state parameter' });
    }

    // Decode state to get user
    const decodedState = decodeState(state);
    if (decodedState.error === 'invalid_state') {
      return reply.status(400).send({ error: 'Invalid state parameter' });
    }
    if (decodedState.error === 'missing_user' || !decodedState.user) {
      return reply.status(400).send({ error: 'Missing user in state parameter' });
    }

    const { user } = decodedState;

    try {
      const credentials = await getOrRegisterClient(config);
      const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;
      const tokenResponse = await fetch(`${config.intendBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
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
        return reply.redirect('/oauth/error?reason=token_exchange_failed');
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      // Calculate expiry
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      // Save tokens for the specific user
      await storage.saveIntendTokens(user, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        baseUrl: config.intendBaseUrl
      });

      console.log(`[OAuth] intend.do connected successfully for user: ${user}`);
      return reply.redirect('/oauth/success?integration=intend');
    } catch (error) {
      console.error('[OAuth] Error during token exchange:', error);
      return reply.redirect('/oauth/error?reason=internal_error');
    }
  });

  // Check auth status
  app.get('/auth/status/intend', async (request, reply) => {
    const { user } = request.query as { user?: string };

    if (!user) {
      return reply.status(400).send({ error: 'Missing required user parameter' });
    }

    const tokens = await storage.getIntendTokens(user);
    const connected = tokens !== null;
    const expired = connected && new Date(tokens.expiresAt) < new Date();
    const blockedCaptures = await storage.listCapturesNeedingAuth();

    return {
      connected,
      expired,
      blockedCaptureCount: blockedCaptures.filter(c =>
        c.routeFinal && c.routeFinal.includes('intend')
      ).length
    };
  });

  // Disconnect
  app.post('/disconnect/intend', async (request, reply) => {
    const { user } = request.query as { user?: string };

    if (!user) {
      return reply.status(400).send({ error: 'Missing required user parameter' });
    }

    await storage.clearIntendTokens(user);
    console.log(`[OAuth] intend.do disconnected for user: ${user}`);
    return { success: true };
  });

  // Simple success/error pages
  app.get('/oauth/success', async (request, reply) => {
    const { integration } = request.query as { integration?: string };
    reply.type('text/html');
    return `
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Connected to ${integration || 'integration'}</h1>
          <p>You can close this window.</p>
        </body>
      </html>
    `;
  });

  app.get('/oauth/error', async (request, reply) => {
    const { reason } = request.query as { reason?: string };
    reply.type('text/html');
    return `
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Connection Failed</h1>
          <p>Reason: ${reason || 'unknown'}</p>
          <p><a href="/connect/intend">Try again</a></p>
        </body>
      </html>
    `;
  });
}
