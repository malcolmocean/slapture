import type { FastifyInstance } from 'fastify';
import type { Storage } from '../storage/index.js';

export interface OAuthConfig {
  intendClientId: string;
  intendClientSecret: string;
  intendBaseUrl: string;
  callbackBaseUrl: string;
}

export function buildOAuthRoutes(
  app: FastifyInstance,
  storage: Storage,
  config: OAuthConfig
): void {

  // Initiate OAuth flow
  app.get('/connect/intend', async (request, reply) => {
    const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;
    const authorizeUrl = new URL(`${config.intendBaseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', config.intendClientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'intentions:write');

    return reply.redirect(authorizeUrl.toString());
  });

  // OAuth callback
  app.get('/oauth/callback/intend', async (request, reply) => {
    const { code } = request.query as { code?: string };

    if (!code) {
      return reply.status(400).send({ error: 'Missing authorization code' });
    }

    try {
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
          client_id: config.intendClientId,
          client_secret: config.intendClientSecret
        })
      });

      if (!tokenResponse.ok) {
        console.error('[OAuth] Token exchange failed:', tokenResponse.status);
        return reply.redirect('/oauth/error?reason=token_exchange_failed');
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      // Calculate expiry
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      await storage.saveIntendTokens({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        baseUrl: config.intendBaseUrl
      });

      console.log('[OAuth] intend.do connected successfully');
      return reply.redirect('/oauth/success?integration=intend');
    } catch (error) {
      console.error('[OAuth] Error during token exchange:', error);
      return reply.redirect('/oauth/error?reason=internal_error');
    }
  });

  // Check auth status
  app.get('/auth/status/intend', async (request, reply) => {
    const tokens = await storage.getIntendTokens();
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
    await storage.clearIntendTokens();
    console.log('[OAuth] intend.do disconnected');
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
