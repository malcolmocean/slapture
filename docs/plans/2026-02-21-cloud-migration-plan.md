# Cloud Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate slapture from Fastify/filesystem to Hono/Firestore, deployable to Cloud Run.

**Architecture:** Three sequential steps — (1) swap Fastify→Hono keeping all logic, (2) add Firestore storage backend behind a shared interface, (3) add Dockerfile for Cloud Run. Each step is independently verifiable.

**Tech Stack:** Hono, @hono/node-server, @google-cloud/firestore, Cloud Run, Docker

---

### Task 1: Install Hono and remove Fastify

**Files:**
- Modify: `package.json`

**Step 1: Remove Fastify, add Hono**

Run:
```bash
pnpm remove fastify @fastify/formbody
pnpm add hono @hono/node-server
```

**Step 2: Verify dependencies installed**

Run: `pnpm ls hono @hono/node-server`
Expected: Both packages listed

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: swap fastify for hono"
```

---

### Task 2: Convert server/index.ts to Hono

**Files:**
- Modify: `src/server/index.ts`

The server currently uses Fastify with `server.inject()` for testing. Hono uses `app.request()` and `app.fetch()`. The key differences:
- `Fastify()` → `new Hono()`
- `server.register(formbody)` → not needed (Hono parses JSON/form bodies natively)
- `server.addHook('onRequest', ...)` → `app.use('*', async (c, next) => { ... })`
- `server.post('/capture', async (request, reply) => {...})` → `app.post('/capture', async (c) => {...})`
- `request.body` → `await c.req.json()`
- `request.query` → `c.req.query('key')` or object from `c.req.queries()`
- `request.params` → `c.req.param('key')`
- `reply.code(401).send({...})` → `return c.json({...}, 401)`
- `reply.type('text/html').send(html)` → `return c.html(html)`
- `reply.redirect(url)` → `return c.redirect(url)`
- The function returns `Hono` instead of `FastifyInstance`

**Step 1: Rewrite src/server/index.ts**

```typescript
// src/server/index.ts
import { Hono } from 'hono';
import { Storage } from '../storage/index.js';
import { CapturePipeline } from '../pipeline/index.js';
import { buildOAuthRoutes } from './oauth.js';
import { buildDashboardRoutes } from '../dashboard/routes.js';
import path from 'path';
import fs from 'fs';

export async function buildServer(
  storage: Storage,
  filestoreRoot: string,
  apiKey: string
): Promise<Hono> {
  const app = new Hono();

  const pipeline = new CapturePipeline(storage, filestoreRoot, apiKey);

  // Auth middleware
  app.use('*', async (c, next) => {
    const pathname = new URL(c.req.url).pathname;

    // Skip auth for widget
    if (pathname === '/widget' || pathname.startsWith('/widget/')) {
      return next();
    }

    // Skip auth for OAuth routes (public endpoints)
    if (pathname.startsWith('/connect/') ||
        pathname.startsWith('/oauth/') ||
        pathname.startsWith('/auth/status/') ||
        pathname.startsWith('/disconnect/')) {
      return next();
    }

    const token = c.req.query('token');
    const config = await storage.getConfig();

    if (token !== config.authToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  });

  // POST /capture
  app.post('/capture', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { text, username = 'default' } = body;

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'text is required' }, 400);
    }

    const result = await pipeline.process(text, username);

    return c.json({
      captureId: result.capture.id,
      status: result.capture.executionResult,
      routeFinal: result.capture.routeFinal,
      needsClarification: result.needsClarification,
    });
  });

  // GET /status/:captureId
  app.get('/status/:captureId', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId);
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404);
    }

    let routeDisplayName: string | null = null;
    if (capture.routeFinal) {
      const route = await storage.getRoute(capture.routeFinal);
      if (route) {
        if (route.destinationType === 'fs') {
          const operation = route.transformScript?.includes('appendFileSync') ? 'append' : 'write';
          routeDisplayName = `${operation}-${(route.destinationConfig as { filePath: string }).filePath}`;
        } else {
          routeDisplayName = `${route.destinationType}-${route.name}`;
        }
      }
    }

    return c.json({ ...capture, routeDisplayName });
  });

  // GET /routes
  app.get('/routes', async (c) => {
    return c.json(await storage.listRoutes());
  });

  // GET /captures
  app.get('/captures', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    return c.json(await storage.listCaptures(limit));
  });

  // GET /captures/blocked
  app.get('/captures/blocked', async (c) => {
    return c.json(await storage.listCapturesNeedingAuth());
  });

  // POST /retry/:captureId
  app.post('/retry/:captureId', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId);
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404);
    }

    if (capture.executionResult !== 'blocked_needs_auth' &&
        capture.executionResult !== 'blocked_auth_expired') {
      return c.json({
        error: 'Capture is not blocked',
        currentStatus: capture.executionResult
      }, 400);
    }

    const result = await pipeline.retryCapture(capture);
    return c.json({ capture: result.capture });
  });

  // GET /widget
  app.get('/widget', async (c) => {
    const widgetPath = path.join(process.cwd(), 'src', 'widget', 'index.html');

    if (!fs.existsSync(widgetPath)) {
      return c.text(`Widget not found at ${widgetPath}`, 404);
    }

    const html = fs.readFileSync(widgetPath, 'utf-8');
    return c.html(html);
  });

  // OAuth routes
  buildOAuthRoutes(app, storage, {
    intendClientId: process.env.INTEND_CLIENT_ID || '',
    intendClientSecret: process.env.INTEND_CLIENT_SECRET || '',
    intendBaseUrl: process.env.INTEND_BASE_URL || 'https://intend.do',
    callbackBaseUrl: process.env.CALLBACK_BASE_URL || 'http://localhost:4444'
  });

  // Dashboard routes
  buildDashboardRoutes(app, storage);

  return app;
}
```

**Step 2: Verify TypeScript compiles**

Run: `pnpm build`
Expected: Errors in oauth.ts and dashboard/routes.ts (they still reference FastifyInstance). server/index.ts should be clean.

---

### Task 3: Convert server/oauth.ts to Hono

**Files:**
- Modify: `src/server/oauth.ts`

**Step 1: Rewrite oauth.ts**

Key changes:
- `FastifyInstance` → `Hono`
- `app.get('/path', async (request, reply) => {...})` → `app.get('/path', async (c) => {...})`
- `request.query as { ... }` → `c.req.query('key')`
- `reply.status(N).send({...})` → `return c.json({...}, N)`
- `reply.redirect(url)` → `return c.redirect(url)`
- `reply.type('text/html'); return html` → `return c.html(html)`

```typescript
// src/server/oauth.ts
import type { Hono } from 'hono';
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
  storage: Storage,
  config: OAuthConfig
): void {

  app.get('/connect/intend', async (c) => {
    const user = c.req.query('user');

    if (!user) {
      return c.json({ error: 'Missing required user parameter' }, 400);
    }

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
      return c.redirect('/oauth/error?reason=registration_failed');
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
        return c.redirect('/oauth/error?reason=token_exchange_failed');
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
      return c.redirect('/oauth/success?integration=intend');
    } catch (error) {
      console.error('[OAuth] Error during token exchange:', error);
      return c.redirect('/oauth/error?reason=internal_error');
    }
  });

  app.get('/auth/status/intend', async (c) => {
    const user = c.req.query('user');

    if (!user) {
      return c.json({ error: 'Missing required user parameter' }, 400);
    }

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
    const user = c.req.query('user');

    if (!user) {
      return c.json({ error: 'Missing required user parameter' }, 400);
    }

    await storage.clearIntendTokens(user);
    console.log(`[OAuth] intend.do disconnected for user: ${user}`);
    return c.json({ success: true });
  });

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
    return c.html(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Connection Failed</h1>
          <p>Reason: ${reason || 'unknown'}</p>
          <p><a href="/connect/intend">Try again</a></p>
        </body>
      </html>
    `);
  });
}
```

**Step 2: Verify no TypeScript errors in oauth.ts**

Run: `pnpm build 2>&1 | grep oauth`
Expected: No errors from oauth.ts (dashboard/routes.ts will still error)

---

### Task 4: Convert dashboard/routes.ts to Hono

**Files:**
- Modify: `src/dashboard/routes.ts`

**Step 1: Rewrite dashboard/routes.ts**

Key changes:
- `FastifyInstance` → `Hono`
- All route handlers: `(request, reply)` → `(c)`
- `request.query` → `c.req.query('key')`
- `request.params` → `c.req.param('key')`
- `request.body` → `await c.req.parseBody()` (for form data)
- `reply.type('text/html').send(html)` → `return c.html(html)`
- `reply.code(N).type('text/html').send(html)` → `return c.html(html, N)`
- `reply.redirect(url)` → `return c.redirect(url)`
- `reply.code(N).send({...})` → `return c.json({...}, N)`

The file is large (~948 lines). The changes are purely mechanical — every route handler gets the same treatment. The template functions (`layout`, `escapeHtml`, etc.) are unchanged.

Replace every occurrence of:
- `import { FastifyInstance } from 'fastify'` → `import type { Hono } from 'hono'`
- `export function buildDashboardRoutes(server: FastifyInstance, storage: Storage): void` → `export function buildDashboardRoutes(app: Hono, storage: Storage): void`
- All `server.get(...)` → `app.get(...)`
- All `server.post(...)` → `app.post(...)`
- Each route handler converted as described above

**Important for form POST handlers (correction submit, verify, retire, approve, reject):** The form body parsing changes from `request.body` (Fastify auto-parses form bodies via formbody plugin) to `await c.req.parseBody()` which returns `Record<string, string | File>`.

**Step 2: Build and verify**

Run: `pnpm build`
Expected: Clean compilation, no errors.

**Step 3: Commit**

```bash
git add src/server/index.ts src/server/oauth.ts src/dashboard/routes.ts
git commit -m "feat: convert server layer from Fastify to Hono"
```

---

### Task 5: Convert entrypoint to use @hono/node-server

**Files:**
- Modify: `src/index.ts`

**Step 1: Update entrypoint**

```typescript
// src/index.ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { buildServer } from './server/index.js';
import { Storage } from './storage/index.js';

const PORT = parseInt(process.env.PORT || '4444', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const FILESTORE_DIR = process.env.FILESTORE_DIR || './filestore';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const storage = new Storage(DATA_DIR);
  await storage.migrateGlobalTokensIfNeeded();
  const app = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY);

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0',
  }, () => {
    console.log(`Slapture server running on http://localhost:${PORT}`);
  });
}

main();
```

**Step 2: Build and verify**

Run: `pnpm build`
Expected: Clean compilation.

**Step 3: Smoke test — start the server**

Run: `ANTHROPIC_API_KEY=test pnpm start`
Expected: Server starts, prints "Slapture server running on http://localhost:4444"
(Kill it after verifying)

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: use @hono/node-server for entrypoint"
```

---

### Task 6: Update unit tests for Hono

**Files:**
- Modify: `tests/unit/server.test.ts`
- Modify: `tests/server/oauth.test.ts`
- Modify: `tests/server/retry.test.ts`

Fastify's `server.inject()` becomes Hono's `app.request()`. The key mapping:

```
// Fastify:
await server.inject({ method: 'POST', url: '/path', payload: {...} })
// returns { statusCode, body, headers }

// Hono:
await app.request('/path', { method: 'POST', body: JSON.stringify({...}), headers: { 'Content-Type': 'application/json' } })
// returns standard Response object: { status, text(), json(), headers }
```

**Step 1: Rewrite tests/unit/server.test.ts**

```typescript
// tests/unit/server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/server/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route } from '../../src/types.js';
import fs from 'fs';
import type { Hono } from 'hono';

const TEST_DATA_DIR = './test-server-data';
const TEST_FILESTORE = './test-server-filestore';

describe('HTTP Server', () => {
  let app: Hono;
  let storage: Storage;

  beforeAll(async () => {
    storage = new Storage(TEST_DATA_DIR);
    await storage.saveConfig({
      authToken: 'test-token',
      requireApproval: false,
      approvalGuardPrompt: null,
      mastermindRetryAttempts: 3,
    });

    const dumpRoute: Route = {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump text',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'user',
      lastUsed: null,
    };
    await storage.saveRoute(dumpRoute);

    app = await buildServer(storage, TEST_FILESTORE, 'test-api-key');
  });

  afterAll(async () => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('POST /capture', () => {
    it('should require auth token', async () => {
      const response = await app.request('/capture', {
        method: 'POST',
        body: JSON.stringify({ text: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });

    it('should accept capture with valid token', async () => {
      const response = await app.request('/capture?token=test-token', {
        method: 'POST',
        body: JSON.stringify({ text: 'dump: hello' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.captureId).toBeDefined();
    });

    it('should reject missing text', async () => {
      const response = await app.request('/capture?token=test-token', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /status/:captureId', () => {
    it('should return capture status', async () => {
      const createResponse = await app.request('/capture?token=test-token', {
        method: 'POST',
        body: JSON.stringify({ text: 'dump: test status' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const { captureId } = await createResponse.json();

      const statusResponse = await app.request(`/status/${captureId}?token=test-token`);

      expect(statusResponse.status).toBe(200);
      const status = await statusResponse.json();
      expect(status.id).toBe(captureId);
    });

    it('should return 404 for unknown capture', async () => {
      const response = await app.request('/status/nonexistent?token=test-token');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /routes', () => {
    it('should list routes', async () => {
      const response = await app.request('/routes?token=test-token');

      expect(response.status).toBe(200);
      const routes = await response.json();
      expect(Array.isArray(routes)).toBe(true);
    });
  });

  describe('GET /captures', () => {
    it('should list recent captures', async () => {
      const response = await app.request('/captures?token=test-token');

      expect(response.status).toBe(200);
      const captures = await response.json();
      expect(Array.isArray(captures)).toBe(true);
    });
  });
});
```

**Step 2: Rewrite tests/server/oauth.test.ts**

Replace `Fastify` import and `app.inject()` calls with Hono equivalents. The key changes:
- `import Fastify from 'fastify'` → `import { Hono } from 'hono'`
- `app = Fastify()` → `app = new Hono()`
- `buildOAuthRoutes(app, storage, config)` stays the same (function signature updated in Task 3)
- `await app.ready()` → remove (Hono doesn't need this)
- `await app.close()` → remove (Hono doesn't need this)
- All `app.inject({method, url, ...})` → `app.request(url, {method, ...})`
- `response.statusCode` → `response.status`
- `response.json()` → `await response.json()`
- `response.headers.location` → `response.headers.get('location')`

```typescript
// tests/server/oauth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'fs';
import { Storage } from '../../src/storage';
import { buildOAuthRoutes } from '../../src/server/oauth';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OAuth Endpoints', () => {
  let app: Hono;
  let storage: Storage;
  const testDir = './test-data-oauth';

  beforeEach(async () => {
    mockFetch.mockReset();
    fs.mkdirSync(testDir, { recursive: true });
    storage = new Storage(testDir);

    app = new Hono();
    buildOAuthRoutes(app, storage, {
      intendClientId: 'test-client-id',
      intendClientSecret: 'test-client-secret',
      intendBaseUrl: 'https://intend.do',
      callbackBaseUrl: 'http://localhost:4444'
    });
  });

  afterEach(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('GET /connect/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.request('/connect/intend');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });

    it('should redirect with user in state parameter', async () => {
      const response = await app.request('/connect/intend?user=malcolm', { redirect: 'manual' });
      expect(response.status).toBe(302);
      const location = response.headers.get('location')!;
      expect(location).toContain('https://intend.do/oauth/authorize');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('state=');

      const url = new URL(location);
      const state = url.searchParams.get('state');
      expect(state).toBeTruthy();
      const decoded = JSON.parse(Buffer.from(state!, 'base64').toString());
      expect(decoded.user).toBe('malcolm');
      expect(decoded.csrf).toBeTruthy();
    });
  });

  describe('GET /oauth/callback/intend', () => {
    it('should handle missing code parameter', async () => {
      const response = await app.request('/oauth/callback/intend');
      expect(response.status).toBe(400);
    });

    it('should require state parameter', async () => {
      const response = await app.request('/oauth/callback/intend?code=auth-code-123');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('state');
    });

    it('should extract user from state and save tokens for that user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        })
      });

      const state = Buffer.from(JSON.stringify({ user: 'malcolm', csrf: 'test-csrf' })).toString('base64');
      const response = await app.request(`/oauth/callback/intend?code=auth-code-123&state=${state}`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/oauth/success');

      const tokens = await storage.getIntendTokens('malcolm');
      expect(tokens?.accessToken).toBe('new-access-token');
      expect(tokens?.refreshToken).toBe('new-refresh-token');

      const defaultTokens = await storage.getIntendTokens('default');
      expect(defaultTokens).toBeNull();
    });

    it('should handle token exchange failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Bad Request'
      });

      const state = Buffer.from(JSON.stringify({ user: 'malcolm', csrf: 'test-csrf' })).toString('base64');
      const response = await app.request(`/oauth/callback/intend?code=bad-code&state=${state}`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/oauth/error');
    });

    it('should handle invalid state parameter (malformed JSON)', async () => {
      const response = await app.request('/oauth/callback/intend?code=auth-code-123&state=invalid-base64');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('state');
    });

    it('should handle state missing user field', async () => {
      const state = Buffer.from(JSON.stringify({ csrf: 'test-csrf' })).toString('base64');
      const response = await app.request(`/oauth/callback/intend?code=auth-code-123&state=${state}`);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });
  });

  describe('GET /auth/status/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.request('/auth/status/intend');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });

    it('should return connected false when no tokens for user', async () => {
      const response = await app.request('/auth/status/intend?user=malcolm');
      const body = await response.json();
      expect(body.connected).toBe(false);
    });

    it('should return connected true when tokens exist for user', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/auth/status/intend?user=malcolm');
      const body = await response.json();
      expect(body.connected).toBe(true);
      expect(body.expired).toBe(false);
    });

    it('should return status for specific user only', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const malcolmResponse = await app.request('/auth/status/intend?user=malcolm');
      expect((await malcolmResponse.json()).connected).toBe(true);

      const defaultResponse = await app.request('/auth/status/intend?user=default');
      expect((await defaultResponse.json()).connected).toBe(false);
    });

    it('should indicate expired tokens', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2020-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/auth/status/intend?user=malcolm');
      const body = await response.json();
      expect(body.connected).toBe(true);
      expect(body.expired).toBe(true);
    });
  });

  describe('POST /disconnect/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.request('/disconnect/intend', { method: 'POST' });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });

    it('should clear tokens for specific user', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/disconnect/intend?user=malcolm', { method: 'POST' });
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);

      const tokens = await storage.getIntendTokens('malcolm');
      expect(tokens).toBeNull();
    });

    it('should clear tokens for specific user only', async () => {
      await storage.saveIntendTokens('user1', {
        accessToken: 'token1',
        refreshToken: 'refresh1',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });
      await storage.saveIntendTokens('user2', {
        accessToken: 'token2',
        refreshToken: 'refresh2',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/disconnect/intend?user=user1', { method: 'POST' });
      expect(response.status).toBe(200);

      const user1Tokens = await storage.getIntendTokens('user1');
      expect(user1Tokens).toBeNull();

      const user2Tokens = await storage.getIntendTokens('user2');
      expect(user2Tokens?.accessToken).toBe('token2');
    });
  });
});
```

**Step 3: Rewrite tests/server/retry.test.ts**

Same pattern as above. Key changes:
- `buildServer` still returns a Hono app
- `app.inject()` → `app.request()`
- `await app.close()` → remove
- `response.statusCode` → `response.status`
- `JSON.parse(response.body)` → `await response.json()`

```typescript
// tests/server/retry.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { buildServer } from '../../src/server';
import { Storage } from '../../src/storage';
import type { Hono } from 'hono';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() }
  }
}));

describe('Retry Blocked Captures', () => {
  let app: Hono;
  let storage: Storage;
  const testDir = './test-data-retry';
  const filestoreDir = './test-filestore-retry';

  beforeEach(async () => {
    mockFetch.mockReset();
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(filestoreDir, { recursive: true });
    storage = new Storage(testDir);

    await storage.saveRoute({
      id: 'route-intend',
      name: 'intend',
      description: 'Send to intend.do',
      triggers: [{ type: 'prefix', pattern: 'intend', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'intend',
      destinationConfig: { baseUrl: 'https://intend.do' },
      transformScript: null,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null
    });

    await storage.saveCapture({
      id: 'blocked-capture-1',
      raw: 'intend: buy groceries',
      timestamp: new Date().toISOString(),
      username: 'default',
      parsed: { explicitRoute: 'intend', payload: 'buy groceries', metadata: {} },
      routeProposed: 'route-intend',
      routeConfidence: 'high',
      routeFinal: 'route-intend',
      executionTrace: [],
      executionResult: 'blocked_needs_auth',
      verificationState: 'pending',
      retiredFromTests: false,
      retiredReason: null
    }, 'default');

    // Need to save config with auth token for the auth middleware
    await storage.saveConfig({
      authToken: 'dev-token',
      requireApproval: false,
      approvalGuardPrompt: null,
      mastermindRetryAttempts: 3,
    });

    app = await buildServer(storage, filestoreDir, 'test-api-key');
  });

  afterEach(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(filestoreDir, { recursive: true, force: true });
  });

  it('should retry blocked capture after OAuth configured', async () => {
    await storage.saveIntendTokens('default', {
      accessToken: 'valid-token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'intention-123', text: 'buy groceries' })
    });

    const response = await app.request('/retry/blocked-capture-1?token=dev-token', { method: 'POST' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.capture.executionResult).toBe('success');
  });

  it('should return 404 for non-existent capture', async () => {
    const response = await app.request('/retry/non-existent?token=dev-token', { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('should list all blocked captures', async () => {
    const response = await app.request('/captures/blocked?token=dev-token');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('blocked-capture-1');
  });

  it('should return 400 when capture is not blocked', async () => {
    await storage.saveCapture({
      id: 'success-capture',
      raw: 'test',
      timestamp: new Date().toISOString(),
      username: 'default',
      parsed: { explicitRoute: null, payload: 'test', metadata: {} },
      routeProposed: null,
      routeConfidence: null,
      routeFinal: null,
      executionTrace: [],
      executionResult: 'success',
      verificationState: 'pending',
      retiredFromTests: false,
      retiredReason: null
    }, 'default');

    const response = await app.request('/retry/success-capture?token=dev-token', { method: 'POST' });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('not blocked');
  });
});
```

**Step 4: Run unit tests**

Run: `pnpm test run`
Expected: All tests pass. If any fail, fix the specific test/implementation mismatch.

**Step 5: Commit**

```bash
git add tests/unit/server.test.ts tests/server/oauth.test.ts tests/server/retry.test.ts
git commit -m "test: update server tests for Hono"
```

---

### Task 7: Run E2E tests to verify full stack

**Files:** None (verification only)

**Step 1: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All E2E tests pass (they hit HTTP endpoints via Playwright, framework-agnostic).

Note: The E2E tests use `pnpm start` which runs `tsx scripts/check-stale.ts && node dist/index.js`. Make sure `pnpm build` has been run first.

If E2E tests fail, investigate whether the issue is:
- Redirect behavior differences (Hono vs Fastify may handle redirect status codes differently — Hono uses 302 by default, Fastify uses 302 by default, so this should be fine)
- Form body parsing differences (dashboard forms use `application/x-www-form-urlencoded`)
- Response format differences (check Content-Type headers)

**Step 2: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address E2E test findings from Hono migration"
```

---

### Task 8: Extract StorageInterface type

**Files:**
- Create: `src/storage/interface.ts`
- Modify: `src/storage/index.ts`

Before building FirestoreStorage, extract the interface that both backends will implement.

**Step 1: Write the interface**

Create `src/storage/interface.ts` with every public method signature from `Storage`:

```typescript
// src/storage/interface.ts
import type { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, TriggerChangeReview } from '../types.js';
import type { HygieneSignal } from '../hygiene/index.js';

export interface StorageInterface {
  // Captures
  saveCapture(capture: Capture, username?: string): Promise<void>;
  getCapture(id: string): Promise<Capture | null>;
  updateCapture(capture: Capture): Promise<void>;
  listCaptures(limit?: number, username?: string): Promise<Capture[]>;
  listAllCaptures(username?: string): Promise<Capture[]>;
  listCapturesNeedingAuth(): Promise<Capture[]>;

  // Routes
  saveRoute(route: Route): Promise<void>;
  getRoute(id: string): Promise<Route | null>;
  listRoutes(): Promise<Route[]>;
  getRouteByName(name: string): Promise<Route | null>;

  // Execution traces
  saveExecutionTrace(captureId: string, trace: ExecutionStep[]): Promise<void>;

  // Config
  getConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;

  // Inbox
  appendToInbox(entry: string): Promise<void>;

  // Evolver test cases
  saveEvolverTestCase(testCase: EvolverTestCase): Promise<void>;
  getEvolverTestCase(id: string): Promise<EvolverTestCase | null>;
  listEvolverTestCases(): Promise<EvolverTestCase[]>;
  deleteEvolverTestCase(id: string): Promise<void>;
  pruneEvolverTestCases(keepRecent?: number): Promise<void>;

  // Per-user tokens
  saveIntendTokens(username: string, tokens: IntendTokens): Promise<void>;
  getIntendTokens(username: string): Promise<IntendTokens | null>;
  clearIntendTokens(username: string): Promise<void>;

  // Integration notes
  getIntegrationNote(username: string, integrationId: string): Promise<string | null>;
  saveIntegrationNote(username: string, integrationId: string, content: string): Promise<void>;

  // Destination notes
  getDestinationNote(username: string, destinationId: string): Promise<string | null>;
  saveDestinationNote(username: string, destinationId: string, content: string): Promise<void>;

  // Hygiene signals
  appendHygieneSignal(signal: HygieneSignal): Promise<void>;
  getHygieneSignals(): Promise<HygieneSignal[]>;
  getHygieneSignalsForRoute(routeId: string): Promise<HygieneSignal[]>;

  // Trigger change reviews
  saveTriggerReview(review: TriggerChangeReview): Promise<void>;
  getTriggerReview(id: string): Promise<TriggerChangeReview | null>;
  listTriggerReviews(status?: TriggerChangeReview['status']): Promise<TriggerChangeReview[]>;
  updateTriggerReviewStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean>;
  deleteTriggerReview(id: string): Promise<void>;
}
```

**Step 2: Add `implements StorageInterface` to existing Storage class**

In `src/storage/index.ts`, add:
```typescript
import type { StorageInterface } from './interface.js';

export class Storage implements StorageInterface {
  // ... existing code unchanged
}
```

Also add a re-export so consumers can import the interface:
```typescript
export type { StorageInterface } from './interface.js';
```

**Step 3: Update consumers to use StorageInterface where appropriate**

The pipeline, server, dashboard, etc. currently import `Storage` directly. For now, keep those imports — they still work. The interface is primarily for the Firestore implementation to target. The consumer type changes can happen incrementally later if needed.

**Step 4: Build and run tests**

Run: `pnpm build && pnpm test run`
Expected: All pass, no behavior change.

**Step 5: Commit**

```bash
git add src/storage/interface.ts src/storage/index.ts
git commit -m "refactor: extract StorageInterface for multi-backend support"
```

---

### Task 9: Implement FirestoreStorage

**Files:**
- Create: `src/storage/firestore.ts`

**Step 1: Install Firestore SDK**

Run: `pnpm add @google-cloud/firestore`

**Step 2: Write FirestoreStorage**

This implements every method from `StorageInterface` using Firestore SDK.

Collection structure:
- `captures` → subcollections per user: `captures/{username}/items/{docId}`
- `routes/{id}`
- `executions/{captureId}`
- `config/main`
- `users/{username}` → subcollections for config, notes
- `evolver-tests/{id}`
- `trigger-reviews/{id}`
- `hygiene-signals/all` (single doc with `signals` array field)
- `inbox/entries/{autoId}`

Key implementation notes:
- `listRoutes()` filters out `destinationType: 'fs'` routes (this is the cloud-mode `fs` filtering)
- `getConfig()` creates a default config document if none exists
- Firestore transactions used where needed for atomic updates (hygiene signals append)
- No `ensureDirectories()` needed — Firestore creates collections/docs implicitly

```typescript
// src/storage/firestore.ts
import { Firestore } from '@google-cloud/firestore';
import type { StorageInterface } from './interface.js';
import type { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, TriggerChangeReview } from '../types.js';
import type { HygieneSignal } from '../hygiene/index.js';

export class FirestoreStorage implements StorageInterface {
  private db: Firestore;

  constructor(projectId?: string) {
    this.db = new Firestore({
      projectId: projectId || process.env.FIREBASE_PROJECT_ID,
    });
  }

  // Captures
  async saveCapture(capture: Capture, username: string = 'default'): Promise<void> {
    const safeTimestamp = capture.timestamp.replace(/:/g, '-').replace(/\./g, '-');
    const docId = `${safeTimestamp}_${capture.id}`;
    await this.db.collection('captures').doc(username).collection('items').doc(docId).set(capture);
  }

  async getCapture(id: string): Promise<Capture | null> {
    // Search all user subcollections via collection group query
    const snapshot = await this.db.collectionGroup('items')
      .where('id', '==', id)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return snapshot.docs[0].data() as Capture;
  }

  async updateCapture(capture: Capture): Promise<void> {
    // Find the doc and update it
    const snapshot = await this.db.collectionGroup('items')
      .where('id', '==', capture.id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      // Save as new
      await this.saveCapture(capture, capture.username || 'default');
      return;
    }

    await snapshot.docs[0].ref.set(capture);
  }

  async listCaptures(limit: number = 50, username?: string): Promise<Capture[]> {
    const captures = await this.listAllCaptures(username);
    return captures
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async listAllCaptures(username?: string): Promise<Capture[]> {
    if (username) {
      const snapshot = await this.db.collection('captures').doc(username).collection('items').get();
      return snapshot.docs.map(doc => doc.data() as Capture);
    }

    // All users via collection group
    const snapshot = await this.db.collectionGroup('items').get();
    return snapshot.docs.map(doc => doc.data() as Capture);
  }

  async listCapturesNeedingAuth(): Promise<Capture[]> {
    const captures = await this.listAllCaptures();
    return captures.filter(c =>
      c.executionResult === 'blocked_needs_auth' ||
      c.executionResult === 'blocked_auth_expired'
    );
  }

  // Routes — filters out fs routes in cloud mode
  async saveRoute(route: Route): Promise<void> {
    await this.db.collection('routes').doc(route.id).set(route);
  }

  async getRoute(id: string): Promise<Route | null> {
    const doc = await this.db.collection('routes').doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as Route;
  }

  async listRoutes(): Promise<Route[]> {
    const snapshot = await this.db.collection('routes').get();
    const routes = snapshot.docs.map(doc => doc.data() as Route);
    // Filter out fs routes — they don't work in cloud mode
    return routes.filter(r => r.destinationType !== 'fs');
  }

  async getRouteByName(name: string): Promise<Route | null> {
    const routes = await this.listRoutes();
    return routes.find(r => r.name === name) || null;
  }

  // Execution traces
  async saveExecutionTrace(captureId: string, trace: ExecutionStep[]): Promise<void> {
    await this.db.collection('executions').doc(captureId).set({ captureId, trace });
  }

  // Config
  async getConfig(): Promise<Config> {
    const doc = await this.db.collection('config').doc('main').get();
    if (!doc.exists) {
      const defaultConfig: Config = {
        authToken: 'dev-token',
        requireApproval: false,
        approvalGuardPrompt: null,
        mastermindRetryAttempts: 3,
      };
      await this.db.collection('config').doc('main').set(defaultConfig);
      return defaultConfig;
    }
    return doc.data() as Config;
  }

  async saveConfig(config: Config): Promise<void> {
    await this.db.collection('config').doc('main').set(config);
  }

  // Inbox
  async appendToInbox(entry: string): Promise<void> {
    await this.db.collection('inbox').add({
      timestamp: new Date().toISOString(),
      entry,
    });
  }

  // Evolver test cases
  async saveEvolverTestCase(testCase: EvolverTestCase): Promise<void> {
    await this.db.collection('evolver-tests').doc(testCase.id).set(testCase);
  }

  async getEvolverTestCase(id: string): Promise<EvolverTestCase | null> {
    const doc = await this.db.collection('evolver-tests').doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as EvolverTestCase;
  }

  async listEvolverTestCases(): Promise<EvolverTestCase[]> {
    const snapshot = await this.db.collection('evolver-tests').get();
    return snapshot.docs.map(doc => doc.data() as EvolverTestCase);
  }

  async deleteEvolverTestCase(id: string): Promise<void> {
    await this.db.collection('evolver-tests').doc(id).delete();
  }

  async pruneEvolverTestCases(keepRecent: number = 5): Promise<void> {
    const allCases = await this.listEvolverTestCases();
    const nonRatchetCases = allCases.filter(tc => !tc.isRatchetCase);
    nonRatchetCases.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const toDelete = nonRatchetCases.slice(keepRecent);
    for (const tc of toDelete) {
      await this.deleteEvolverTestCase(tc.id);
    }
  }

  // Per-user tokens
  async saveIntendTokens(username: string, tokens: IntendTokens): Promise<void> {
    await this.db.collection('users').doc(username).set(
      { integrations: { intend: tokens } },
      { merge: true }
    );
  }

  async getIntendTokens(username: string): Promise<IntendTokens | null> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return data?.integrations?.intend || null;
  }

  async clearIntendTokens(username: string): Promise<void> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return;
    const data = doc.data() || {};
    if (data.integrations) {
      delete data.integrations.intend;
      await this.db.collection('users').doc(username).set(data);
    }
  }

  // Integration notes
  async getIntegrationNote(username: string, integrationId: string): Promise<string | null> {
    const doc = await this.db.collection('users').doc(username)
      .collection('notes').doc(`integration-${integrationId}`).get();
    if (!doc.exists) return null;
    return doc.data()?.content || null;
  }

  async saveIntegrationNote(username: string, integrationId: string, content: string): Promise<void> {
    await this.db.collection('users').doc(username)
      .collection('notes').doc(`integration-${integrationId}`)
      .set({ content });
  }

  // Destination notes
  async getDestinationNote(username: string, destinationId: string): Promise<string | null> {
    const safeId = destinationId.replace(/[/\\:*?"<>|]/g, '_');
    const doc = await this.db.collection('users').doc(username)
      .collection('notes').doc(`destination-${safeId}`).get();
    if (!doc.exists) return null;
    return doc.data()?.content || null;
  }

  async saveDestinationNote(username: string, destinationId: string, content: string): Promise<void> {
    const safeId = destinationId.replace(/[/\\:*?"<>|]/g, '_');
    await this.db.collection('users').doc(username)
      .collection('notes').doc(`destination-${safeId}`)
      .set({ content });
  }

  // Hygiene signals
  async appendHygieneSignal(signal: HygieneSignal): Promise<void> {
    await this.db.collection('hygiene-signals').add(signal);
  }

  async getHygieneSignals(): Promise<HygieneSignal[]> {
    const snapshot = await this.db.collection('hygiene-signals').get();
    return snapshot.docs.map(doc => doc.data() as HygieneSignal);
  }

  async getHygieneSignalsForRoute(routeId: string): Promise<HygieneSignal[]> {
    const snapshot = await this.db.collection('hygiene-signals')
      .where('routeId', '==', routeId).get();
    return snapshot.docs.map(doc => doc.data() as HygieneSignal);
  }

  // Trigger change reviews
  async saveTriggerReview(review: TriggerChangeReview): Promise<void> {
    await this.db.collection('trigger-reviews').doc(review.id).set(review);
  }

  async getTriggerReview(id: string): Promise<TriggerChangeReview | null> {
    const doc = await this.db.collection('trigger-reviews').doc(id).get();
    if (!doc.exists) return null;
    return doc.data() as TriggerChangeReview;
  }

  async listTriggerReviews(status?: TriggerChangeReview['status']): Promise<TriggerChangeReview[]> {
    let query: FirebaseFirestore.Query = this.db.collection('trigger-reviews');
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.data() as TriggerChangeReview);
  }

  async updateTriggerReviewStatus(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
    const review = await this.getTriggerReview(id);
    if (!review) return false;
    review.status = status;
    await this.saveTriggerReview(review);
    return true;
  }

  async deleteTriggerReview(id: string): Promise<void> {
    await this.db.collection('trigger-reviews').doc(id).delete();
  }
}
```

**Step 3: Build**

Run: `pnpm build`
Expected: Clean compilation.

**Step 4: Commit**

```bash
git add src/storage/firestore.ts package.json pnpm-lock.yaml
git commit -m "feat: add FirestoreStorage backend"
```

---

### Task 10: Wire up storage backend switching in entrypoint

**Files:**
- Modify: `src/index.ts`
- Modify: `src/storage/index.ts` (add re-export)

**Step 1: Update src/index.ts to conditionally create storage**

```typescript
// src/index.ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { buildServer } from './server/index.js';
import { Storage } from './storage/index.js';
import { FirestoreStorage } from './storage/firestore.js';
import type { StorageInterface } from './storage/interface.js';

const PORT = parseInt(process.env.PORT || '4444', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const FILESTORE_DIR = process.env.FILESTORE_DIR || './filestore';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'local';

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  let storage: StorageInterface;

  if (STORAGE_BACKEND === 'firestore') {
    console.log('[Storage] Using Firestore backend');
    storage = new FirestoreStorage();
  } else {
    console.log('[Storage] Using local filesystem backend');
    const fsStorage = new Storage(DATA_DIR);
    await fsStorage.migrateGlobalTokensIfNeeded();
    storage = fsStorage;
  }

  const app = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY);

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0',
  }, () => {
    console.log(`Slapture server running on http://localhost:${PORT}`);
  });
}

main();
```

**Step 2: Update buildServer and consumers to accept StorageInterface**

Update `src/server/index.ts` parameter type:
```typescript
import type { StorageInterface } from '../storage/interface.js';
// ...
export async function buildServer(
  storage: StorageInterface,
  filestoreRoot: string,
  apiKey: string
): Promise<Hono> {
```

Similarly update `src/pipeline/index.ts`, `src/dashboard/routes.ts`, `src/server/oauth.ts`, and any other files that take a `Storage` parameter — change the type to `StorageInterface`.

Note: Some files reference `Storage` methods that aren't on the interface (like `migrateGlobalTokensIfNeeded`). Those are local-only operations and should stay on the concrete `Storage` class only, called in the entrypoint before passing the storage to the server.

**Step 3: Build and test**

Run: `pnpm build && pnpm test run`
Expected: All pass (still using local storage by default).

**Step 4: Commit**

```bash
git add src/index.ts src/server/index.ts src/pipeline/index.ts src/dashboard/routes.ts src/server/oauth.ts src/storage/index.ts
git commit -m "feat: wire up storage backend switching via STORAGE_BACKEND env"
```

---

### Task 11: Add Dockerfile and .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Step 1: Write Dockerfile**

```dockerfile
FROM node:22-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Production stage
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/widget ./src/widget

ENV PORT=8080
CMD ["node", "dist/index.js"]
```

**Step 2: Write .dockerignore**

```
node_modules
dist
data
filestore
.env
firebase-service-account.json
*.md
tests
.git
.claude
tmp
```

**Step 3: Test Docker build locally**

Run: `docker build -t slapture .`
Expected: Builds successfully.

**Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile for Cloud Run deployment"
```

---

### Task 12: Test Firestore integration locally

**Files:** None (verification only)

**Step 1: Start server with Firestore backend**

Run (with service account key available):
```bash
STORAGE_BACKEND=firestore ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY pnpm dev
```

**Step 2: Send a test capture**

Run:
```bash
curl -X POST http://localhost:4444/capture?token=dev-token \
  -H 'Content-Type: application/json' \
  -d '{"text": "test firestore capture"}'
```

Expected: 200 response with captureId.

**Step 3: Verify in Firestore console**

Check the Firebase console — the capture should appear in `captures/default/items/`.

**Step 4: Verify fs routes are filtered**

If there are any `fs` routes in Firestore, `GET /routes` should not return them.

---

### Task 13: Deploy to Cloud Run

**Files:** None (deployment only, manual steps)

**Step 1: Deploy**

```bash
gcloud run deploy slapture \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars "STORAGE_BACKEND=firestore" \
  --set-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest"
```

Note: The `ANTHROPIC_API_KEY` secret needs to be created in Google Secret Manager first:
```bash
echo -n "$ANTHROPIC_API_KEY" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
```

**Step 2: Verify deployment**

Run: `curl https://<cloud-run-url>/routes?token=dev-token`
Expected: JSON array of routes (no `fs` routes).

**Step 3: Set up custom domain**

Follow HUMAN.md for DNS setup.
