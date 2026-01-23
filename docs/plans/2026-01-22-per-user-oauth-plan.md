# Per-User OAuth Token Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store OAuth tokens per-user so multiple users can have separate intend.do connections.

**Architecture:** Move token storage from global `config.json` to per-user `data/users/{username}/config.json`. Thread username through OAuth flow via state parameter and through executor via capture object.

**Tech Stack:** TypeScript, Vitest, Fastify

---

## Task 1: Add username to Capture type

**Files:**
- Modify: `src/types.ts:1-25`
- Test: `tests/storage/storage.test.ts`

**Step 1: Write the failing test**

Add to `tests/storage/storage.test.ts`:

```typescript
describe('Capture username field', () => {
  it('should store and retrieve capture with username', async () => {
    const capture: Capture = {
      id: 'test-id',
      raw: 'test',
      timestamp: new Date().toISOString(),
      username: 'malcolm',  // New field
      parsed: null,
      routeProposed: null,
      routeConfidence: null,
      routeFinal: null,
      executionTrace: [],
      executionResult: 'pending',
      verificationState: 'pending',
      retiredFromTests: false,
      retiredReason: null,
    };

    await storage.saveCapture(capture, 'malcolm');
    const retrieved = await storage.getCapture('test-id');
    expect(retrieved?.username).toBe('malcolm');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/storage/storage.test.ts`
Expected: FAIL - `username` not in Capture type

**Step 3: Add username to Capture interface**

In `src/types.ts`, add after line 4:

```typescript
export interface Capture {
  id: string;
  raw: string;
  timestamp: string;
  username: string;  // Add this line
  // ... rest unchanged
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/storage/storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts tests/storage/storage.test.ts
git commit -m "feat: add username field to Capture type"
```

---

## Task 2: Add per-user config storage methods

**Files:**
- Modify: `src/storage/index.ts:240-259`
- Test: `tests/storage/storage.test.ts`

**Step 1: Write the failing test**

Add to `tests/storage/storage.test.ts`:

```typescript
describe('Per-user token storage', () => {
  it('should save and retrieve tokens for specific user', async () => {
    const tokens: IntendTokens = {
      accessToken: 'token-for-malcolm',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    };

    await storage.saveIntendTokens('malcolm', tokens);
    const retrieved = await storage.getIntendTokens('malcolm');
    expect(retrieved?.accessToken).toBe('token-for-malcolm');

    // Different user should have no tokens
    const otherUser = await storage.getIntendTokens('default');
    expect(otherUser).toBeNull();
  });

  it('should store tokens in users directory', async () => {
    const tokens: IntendTokens = {
      accessToken: 'test',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    };

    await storage.saveIntendTokens('testuser', tokens);

    const userConfigPath = path.join(testDir, 'users', 'testuser', 'config.json');
    expect(fs.existsSync(userConfigPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
    expect(config.integrations.intend.accessToken).toBe('test');
  });

  it('should clear tokens for specific user only', async () => {
    await storage.saveIntendTokens('user1', {
      accessToken: 'token1',
      refreshToken: 'r1',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });
    await storage.saveIntendTokens('user2', {
      accessToken: 'token2',
      refreshToken: 'r2',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    await storage.clearIntendTokens('user1');

    expect(await storage.getIntendTokens('user1')).toBeNull();
    expect((await storage.getIntendTokens('user2'))?.accessToken).toBe('token2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/storage/storage.test.ts`
Expected: FAIL - methods don't accept username parameter

**Step 3: Update storage methods**

Replace methods in `src/storage/index.ts` (lines 240-259):

```typescript
  // Per-user config management
  private ensureUserDir(username: string): string {
    const userDir = path.join(this.dataDir, 'users', username);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
  }

  private getUserConfigPath(username: string): string {
    return path.join(this.ensureUserDir(username), 'config.json');
  }

  private async getUserConfig(username: string): Promise<{ integrations?: { intend?: IntendTokens } }> {
    const configPath = this.getUserConfigPath(username);
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  }

  private async saveUserConfig(username: string, config: { integrations?: { intend?: IntendTokens } }): Promise<void> {
    const configPath = this.getUserConfigPath(username);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // Integration Token Storage (intend.do OAuth) - now per-user
  async saveIntendTokens(username: string, tokens: IntendTokens): Promise<void> {
    const config = await this.getUserConfig(username);
    config.integrations = config.integrations || {};
    config.integrations.intend = tokens;
    await this.saveUserConfig(username, config);
  }

  async getIntendTokens(username: string): Promise<IntendTokens | null> {
    const config = await this.getUserConfig(username);
    return config.integrations?.intend || null;
  }

  async clearIntendTokens(username: string): Promise<void> {
    const config = await this.getUserConfig(username);
    if (config.integrations) {
      delete config.integrations.intend;
      await this.saveUserConfig(username, config);
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/storage/storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/index.ts tests/storage/storage.test.ts
git commit -m "feat: per-user OAuth token storage"
```

---

## Task 3: Update OAuth endpoints to use user parameter

**Files:**
- Modify: `src/server/oauth.ts:63-163`
- Test: `tests/server/oauth.test.ts`

**Step 1: Write the failing tests**

Replace/update tests in `tests/server/oauth.test.ts`:

```typescript
describe('GET /connect/intend', () => {
  it('should require user parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/connect/intend'
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('user');
  });

  it('should redirect with user in state parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/connect/intend?user=malcolm'
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location as string;
    expect(location).toContain('state=');

    // Decode state to verify user is encoded
    const url = new URL(location);
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(state!, 'base64').toString());
    expect(decoded.user).toBe('malcolm');
  });
});

describe('GET /oauth/callback/intend', () => {
  it('should extract user from state and save tokens for that user', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'malcolm-token',
        refresh_token: 'malcolm-refresh',
        expires_in: 3600
      })
    });

    const state = Buffer.from(JSON.stringify({ user: 'malcolm', csrf: 'test' })).toString('base64');
    const response = await app.inject({
      method: 'GET',
      url: `/oauth/callback/intend?code=auth-code-123&state=${state}`
    });

    expect(response.statusCode).toBe(302);

    // Verify tokens saved for correct user
    const tokens = await storage.getIntendTokens('malcolm');
    expect(tokens?.accessToken).toBe('malcolm-token');

    // Verify other users don't have tokens
    const defaultTokens = await storage.getIntendTokens('default');
    expect(defaultTokens).toBeNull();
  });
});

describe('GET /auth/status/intend', () => {
  it('should require user parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/status/intend'
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return status for specific user', async () => {
    await storage.saveIntendTokens('malcolm', {
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/status/intend?user=malcolm'
    });
    expect(response.json().connected).toBe(true);

    const response2 = await app.inject({
      method: 'GET',
      url: '/auth/status/intend?user=default'
    });
    expect(response2.json().connected).toBe(false);
  });
});

describe('POST /disconnect/intend', () => {
  it('should require user parameter', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/disconnect/intend'
    });
    expect(response.statusCode).toBe(400);
  });

  it('should clear tokens for specific user only', async () => {
    await storage.saveIntendTokens('user1', {
      accessToken: 't1', refreshToken: 'r1',
      expiresAt: '2030-01-01T00:00:00Z', baseUrl: 'https://intend.do'
    });
    await storage.saveIntendTokens('user2', {
      accessToken: 't2', refreshToken: 'r2',
      expiresAt: '2030-01-01T00:00:00Z', baseUrl: 'https://intend.do'
    });

    await app.inject({
      method: 'POST',
      url: '/disconnect/intend?user=user1'
    });

    expect(await storage.getIntendTokens('user1')).toBeNull();
    expect((await storage.getIntendTokens('user2'))?.accessToken).toBe('t2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/server/oauth.test.ts`
Expected: FAIL

**Step 3: Update OAuth endpoints**

In `src/server/oauth.ts`, update the endpoints:

```typescript
// Initiate OAuth flow
app.get('/connect/intend', async (request, reply) => {
  const { user } = request.query as { user?: string };

  if (!user) {
    return reply.status(400).send({ error: 'Missing required parameter: user' });
  }

  try {
    const credentials = await getOrRegisterClient(config);
    const redirectUri = `${config.callbackBaseUrl}/oauth/callback/intend`;
    const authorizeUrl = new URL(`${config.intendBaseUrl}/oauth/authorize`);

    // Encode user in state parameter
    const state = Buffer.from(JSON.stringify({ user, csrf: Date.now().toString() })).toString('base64');

    authorizeUrl.searchParams.set('client_id', credentials.client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'mcp:tools');
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

  // Decode user from state
  let user = 'default';
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      user = decoded.user || 'default';
    } catch {
      console.error('[OAuth] Failed to decode state parameter');
    }
  }

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

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await storage.saveIntendTokens(user, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      baseUrl: config.intendBaseUrl
    });

    console.log(`[OAuth] intend.do connected for user: ${user}`);
    return reply.redirect(`/oauth/success?integration=intend&user=${user}`);
  } catch (error) {
    console.error('[OAuth] Error during token exchange:', error);
    return reply.redirect('/oauth/error?reason=internal_error');
  }
});

// Check auth status
app.get('/auth/status/intend', async (request, reply) => {
  const { user } = request.query as { user?: string };

  if (!user) {
    return reply.status(400).send({ error: 'Missing required parameter: user' });
  }

  const tokens = await storage.getIntendTokens(user);
  const connected = tokens !== null;
  const expired = connected && new Date(tokens.expiresAt) < new Date();

  return {
    user,
    connected,
    expired,
  };
});

// Disconnect
app.post('/disconnect/intend', async (request, reply) => {
  const { user } = request.query as { user?: string };

  if (!user) {
    return reply.status(400).send({ error: 'Missing required parameter: user' });
  }

  await storage.clearIntendTokens(user);
  console.log(`[OAuth] intend.do disconnected for user: ${user}`);
  return { success: true, user };
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/server/oauth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/oauth.ts tests/server/oauth.test.ts
git commit -m "feat: OAuth endpoints use per-user token storage"
```

---

## Task 4: Update IntendExecutor to use capture's username

**Files:**
- Modify: `src/routes/intend-executor.ts:18-27`
- Test: `tests/routes/intend-executor.test.ts` (create if needed)

**Step 1: Write the failing test**

Create/update `tests/routes/intend-executor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { Storage } from '../../src/storage';
import { IntendExecutor } from '../../src/routes/intend-executor';
import type { Capture, Route } from '../../src/types';

describe('IntendExecutor per-user tokens', () => {
  let storage: Storage;
  let executor: IntendExecutor;
  const testDir = './test-data-intend-executor';

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    storage = new Storage(testDir);
    executor = new IntendExecutor(storage);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const createCapture = (username: string): Capture => ({
    id: 'test-id',
    raw: 'intend: test intention',
    timestamp: new Date().toISOString(),
    username,
    parsed: { explicitRoute: null, payload: 'test intention', metadata: {} },
    routeProposed: null,
    routeConfidence: null,
    routeFinal: 'route-1',
    executionTrace: [],
    executionResult: 'pending',
    verificationState: 'pending',
    retiredFromTests: false,
    retiredReason: null,
  });

  const intendRoute: Route = {
    id: 'route-1',
    name: 'intend',
    description: 'Send to intend.do',
    triggers: [],
    destinationType: 'intend',
    destinationConfig: { baseUrl: 'https://intend.do' },
    transformScript: null,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    recentItems: [],
  };

  it('should use tokens from capture username', async () => {
    // Setup tokens for malcolm only
    await storage.saveIntendTokens('malcolm', {
      accessToken: 'malcolm-token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    // Capture for malcolm should find tokens
    const malcolmCapture = createCapture('malcolm');
    const result1 = await executor.execute(intendRoute, malcolmCapture);
    // Won't be blocked_needs_auth since tokens exist
    expect(result1.status).not.toBe('blocked_needs_auth');

    // Capture for default should be blocked
    const defaultCapture = createCapture('default');
    const result2 = await executor.execute(intendRoute, defaultCapture);
    expect(result2.status).toBe('blocked_needs_auth');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/routes/intend-executor.test.ts`
Expected: FAIL - IntendExecutor doesn't use capture.username

**Step 3: Update IntendExecutor**

In `src/routes/intend-executor.ts`, update execute method:

```typescript
async execute(route: Route, capture: Capture): Promise<IntendExecutionResult> {
  // Get tokens for the capture's user
  const tokens = await this.storage.getIntendTokens(capture.username);

  if (!tokens) {
    return {
      status: 'blocked_needs_auth',
      error: `intend.do OAuth not configured for user: ${capture.username}. Please connect your account.`
    };
  }

  // ... rest unchanged
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/routes/intend-executor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/intend-executor.ts tests/routes/intend-executor.test.ts
git commit -m "feat: IntendExecutor uses capture's username for token lookup"
```

---

## Task 5: Update pipeline to set username on captures

**Files:**
- Modify: `src/pipeline/index.ts:41-55, 446-504`
- Test: `tests/pipeline/pipeline.test.ts`

**Step 1: Write the failing test**

Add to pipeline tests:

```typescript
it('should store username on capture object', async () => {
  const result = await pipeline.process('test capture', 'malcolm');
  expect(result.capture.username).toBe('malcolm');
});

it('should use stored username in retryCapture', async () => {
  // Create a blocked capture for specific user
  const capture: Capture = {
    id: 'retry-test',
    raw: 'intend: retry test',
    timestamp: new Date().toISOString(),
    username: 'testuser',
    parsed: { explicitRoute: null, payload: 'retry test', metadata: {} },
    routeProposed: 'intend-route',
    routeConfidence: 'high',
    routeFinal: 'intend-route',
    executionTrace: [],
    executionResult: 'blocked_needs_auth',
    verificationState: 'pending',
    retiredFromTests: false,
    retiredReason: null,
  };

  await storage.saveCapture(capture, 'testuser');

  // Retry should use capture.username, not hardcoded 'default'
  const result = await pipeline.retryCapture(capture);
  // Verify it tried to get tokens for 'testuser'
  expect(result.capture.username).toBe('testuser');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/pipeline`
Expected: FAIL - username not set on capture

**Step 3: Update pipeline**

In `src/pipeline/index.ts`:

1. Set username when creating capture (line ~42):
```typescript
const capture: Capture = {
  id: uuidv4(),
  raw,
  timestamp: new Date().toISOString(),
  username,  // Add this line
  parsed: null,
  // ... rest unchanged
};
```

2. Use capture.username in retryCapture (lines 459, 467, 491):
```typescript
async retryCapture(capture: Capture): Promise<{ capture: Capture }> {
  const route = await this.storage.getRoute(capture.routeFinal!);
  if (!route) {
    capture.executionResult = 'failed';
    capture.executionTrace.push({
      step: 'execute',
      timestamp: new Date().toISOString(),
      input: { retryAttempt: true },
      output: { error: 'Route no longer exists' },
      codeVersion: this.codeVersion,
      durationMs: 0
    });
    await this.storage.saveCapture(capture, capture.username);  // Use capture.username
    return { capture };
  }

  const startTime = Date.now();
  const result = await this.executor.execute(
    route,
    capture.parsed?.payload || capture.raw,
    capture.username,  // Use capture.username
    capture.parsed?.metadata || {},
    capture.timestamp,
    capture
  );

  // ... (status mapping unchanged)

  await this.storage.saveCapture(capture, capture.username);  // Use capture.username

  // ... rest unchanged
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/pipeline`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/index.ts tests/pipeline/pipeline.test.ts
git commit -m "feat: pipeline stores username on capture and uses it for retry"
```

---

## Task 6: Migration for existing global tokens

**Files:**
- Modify: `src/storage/index.ts` (add migration method)
- Modify: `src/index.ts` or server startup
- Test: `tests/storage/storage.test.ts`

**Step 1: Write the failing test**

```typescript
describe('Token migration', () => {
  it('should migrate global tokens to default user on first access', async () => {
    // Setup: write tokens in old global format
    const globalConfig = {
      authToken: 'dev-token',
      requireApproval: false,
      integrations: {
        intend: {
          accessToken: 'old-global-token',
          refreshToken: 'old-refresh',
          expiresAt: '2030-01-01T00:00:00Z',
          baseUrl: 'https://intend.do'
        }
      }
    };
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify(globalConfig, null, 2)
    );

    // Trigger migration
    await storage.migrateGlobalTokensIfNeeded();

    // Verify tokens moved to default user
    const userTokens = await storage.getIntendTokens('default');
    expect(userTokens?.accessToken).toBe('old-global-token');

    // Verify global config no longer has tokens
    const newGlobalConfig = JSON.parse(
      fs.readFileSync(path.join(testDir, 'config.json'), 'utf-8')
    );
    expect(newGlobalConfig.integrations?.intend).toBeUndefined();
  });

  it('should not migrate if already migrated', async () => {
    // Setup: user already has tokens
    await storage.saveIntendTokens('default', {
      accessToken: 'user-token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    // Old global config with different token
    const globalConfig = {
      authToken: 'dev-token',
      integrations: {
        intend: {
          accessToken: 'should-not-overwrite',
          refreshToken: 'old',
          expiresAt: '2030-01-01T00:00:00Z',
          baseUrl: 'https://intend.do'
        }
      }
    };
    fs.writeFileSync(
      path.join(testDir, 'config.json'),
      JSON.stringify(globalConfig, null, 2)
    );

    await storage.migrateGlobalTokensIfNeeded();

    // User tokens should be unchanged
    const userTokens = await storage.getIntendTokens('default');
    expect(userTokens?.accessToken).toBe('user-token');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/storage/storage.test.ts`
Expected: FAIL - method doesn't exist

**Step 3: Add migration method**

In `src/storage/index.ts`:

```typescript
async migrateGlobalTokensIfNeeded(): Promise<void> {
  const globalConfigPath = path.join(this.dataDir, 'config.json');
  if (!fs.existsSync(globalConfigPath)) {
    return;
  }

  const globalConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
  const globalTokens = globalConfig.integrations?.intend;

  if (!globalTokens) {
    return; // Nothing to migrate
  }

  // Check if default user already has tokens (don't overwrite)
  const existingUserTokens = await this.getIntendTokens('default');
  if (existingUserTokens) {
    // Just clean up global config
    delete globalConfig.integrations.intend;
    if (Object.keys(globalConfig.integrations).length === 0) {
      delete globalConfig.integrations;
    }
    fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2));
    console.log('[Migration] Removed stale global tokens (user tokens exist)');
    return;
  }

  // Migrate to default user
  await this.saveIntendTokens('default', globalTokens);

  // Clean up global config
  delete globalConfig.integrations.intend;
  if (Object.keys(globalConfig.integrations).length === 0) {
    delete globalConfig.integrations;
  }
  fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2));

  console.log('[Migration] Migrated global tokens to user: default');
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/storage/storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/index.ts tests/storage/storage.test.ts
git commit -m "feat: add migration for global tokens to per-user storage"
```

---

## Task 7: Call migration on server startup

**Files:**
- Modify: `src/server/index.ts` or `src/index.ts`

**Step 1: Find server startup code**

Check where the server initializes storage and add migration call.

**Step 2: Add migration call**

```typescript
// After storage is initialized
await storage.migrateGlobalTokensIfNeeded();
```

**Step 3: Run all tests**

Run: `pnpm test`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: run token migration on server startup"
```

---

## Task 8: Update E2E tests

**Files:**
- Modify: `tests/e2e/intend-oauth.spec.ts`

**Step 1: Update E2E tests to use user parameter**

Update tests to include `?user=default` in OAuth URLs and verify per-user behavior.

**Step 2: Run E2E tests**

Run: `pnpm test:e2e`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/e2e/intend-oauth.spec.ts
git commit -m "test: update E2E tests for per-user OAuth"
```

---

## Task 9: Final integration test

**Step 1: Manual verification**

1. Start server
2. Go to `/connect/intend?user=default`
3. Authenticate as qtess/q
4. Verify tokens saved in `data/users/default/config.json`
5. Check `/auth/status/intend?user=default` returns connected
6. Check `/auth/status/intend?user=malcolm` returns not connected

**Step 2: Run full test suite**

Run: `pnpm test && pnpm test:e2e`
Expected: All PASS

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete per-user OAuth token storage"
```
