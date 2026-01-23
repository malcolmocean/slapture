# Phase 2: Real Integration (intend.do) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish OAuth pattern with intend.do integration, proving captures can flow to external services.

**Architecture:** Add OAuth executor alongside existing filesystem executor. New `blocked_needs_auth` state pauses captures until OAuth completes. Token storage in config.json under `integrations.intend`. Server gains `/connect/intend` and `/oauth/callback/intend` endpoints.

**Tech Stack:** Fastify HTTP server, Anthropic API (existing), intend.do OAuth 2.0, Playwright for E2E tests.

---

## Task 1: Extend Types for OAuth

**Files:**
- Modify: `src/types.ts`

**Step 1: Write the test for new execution result states**

```typescript
// tests/types.test.ts
import { describe, it, expect } from 'vitest';
import type { Capture, Route, IntegrationConfig } from '../src/types';

describe('OAuth Types', () => {
  it('should allow blocked_needs_auth execution result', () => {
    const capture: Partial<Capture> = {
      executionResult: 'blocked_needs_auth'
    };
    expect(capture.executionResult).toBe('blocked_needs_auth');
  });

  it('should allow blocked_auth_expired execution result', () => {
    const capture: Partial<Capture> = {
      executionResult: 'blocked_auth_expired'
    };
    expect(capture.executionResult).toBe('blocked_auth_expired');
  });

  it('should support intend destination type', () => {
    const route: Partial<Route> = {
      destinationType: 'intend',
      destinationConfig: {
        baseUrl: 'https://intend.do'
      }
    };
    expect(route.destinationType).toBe('intend');
  });

  it('should support integration config structure', () => {
    const config: IntegrationConfig = {
      intend: {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-01-22T12:00:00Z',
        baseUrl: 'https://intend.do'
      }
    };
    expect(config.intend?.accessToken).toBe('test-token');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/types.test.ts`
Expected: FAIL - type errors for new values

**Step 3: Extend types.ts with OAuth support**

In `src/types.ts`, update the `executionResult` type:

```typescript
// Replace existing executionResult union
executionResult:
  | 'success'
  | 'failed'
  | 'pending'
  | 'rejected'
  | 'blocked_needs_auth'    // Waiting for user to complete OAuth
  | 'blocked_auth_expired'; // Had auth, it expired
```

Add destination type union and config:

```typescript
// Replace existing destinationType
destinationType: 'fs' | 'intend';

// Update destinationConfig to be union
destinationConfig:
  | { filePath: string }  // fs
  | { baseUrl: string };  // intend
```

Add integration config types:

```typescript
export interface IntendTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;  // ISO 8601
  baseUrl: string;
}

export interface IntegrationConfig {
  intend?: IntendTokens;
}

// Update Config interface
export interface Config {
  authToken: string;
  requireApproval: boolean;
  approvalGuardPrompt: string | null;
  mastermindRetryAttempts: number;
  integrations?: IntegrationConfig;  // NEW
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat(types): add OAuth execution states and intend destination type"
```

---

## Task 2: Add Integration Storage Methods

**Files:**
- Modify: `src/storage/index.ts`
- Test: `tests/storage.test.ts`

**Step 1: Write the test for integration storage**

```typescript
// tests/storage.test.ts - add to existing or create
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../src/storage';
import * as fs from 'fs';
import * as path from 'path';

describe('Integration Storage', () => {
  let storage: Storage;
  const testDir = './test-data-storage';

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    storage = new Storage(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should save and retrieve intend tokens', async () => {
    const tokens = {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: '2026-01-22T12:00:00Z',
      baseUrl: 'https://intend.do'
    };

    await storage.saveIntendTokens(tokens);
    const retrieved = await storage.getIntendTokens();

    expect(retrieved).toEqual(tokens);
  });

  it('should return null when no intend tokens exist', async () => {
    const tokens = await storage.getIntendTokens();
    expect(tokens).toBeNull();
  });

  it('should clear intend tokens', async () => {
    const tokens = {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: '2026-01-22T12:00:00Z',
      baseUrl: 'https://intend.do'
    };

    await storage.saveIntendTokens(tokens);
    await storage.clearIntendTokens();
    const retrieved = await storage.getIntendTokens();

    expect(retrieved).toBeNull();
  });

  it('should list captures needing auth', async () => {
    // Create a blocked capture
    const capture = {
      id: 'test-capture-1',
      raw: 'intend: test intention',
      timestamp: new Date().toISOString(),
      parsed: { explicitRoute: 'intend', payload: 'test intention', metadata: {} },
      routeProposed: 'intend-route',
      routeConfidence: 'high' as const,
      routeFinal: 'intend-route',
      executionTrace: [],
      executionResult: 'blocked_needs_auth' as const,
      verificationState: 'pending' as const,
      retiredFromTests: false,
      retiredReason: null
    };

    await storage.saveCapture(capture, 'default');
    const blocked = await storage.listCapturesNeedingAuth();

    expect(blocked.length).toBe(1);
    expect(blocked[0].id).toBe('test-capture-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/storage.test.ts`
Expected: FAIL - methods don't exist

**Step 3: Implement integration storage methods**

In `src/storage/index.ts`, add methods:

```typescript
import type { IntendTokens, Capture } from '../types';

// Add to Storage class:

async saveIntendTokens(tokens: IntendTokens): Promise<void> {
  const config = await this.getConfig();
  config.integrations = config.integrations || {};
  config.integrations.intend = tokens;
  await this.saveConfig(config);
}

async getIntendTokens(): Promise<IntendTokens | null> {
  const config = await this.getConfig();
  return config.integrations?.intend || null;
}

async clearIntendTokens(): Promise<void> {
  const config = await this.getConfig();
  if (config.integrations) {
    delete config.integrations.intend;
    await this.saveConfig(config);
  }
}

async listCapturesNeedingAuth(): Promise<Capture[]> {
  const captures = await this.listAllCaptures();
  return captures.filter(c =>
    c.executionResult === 'blocked_needs_auth' ||
    c.executionResult === 'blocked_auth_expired'
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/index.ts tests/storage.test.ts
git commit -m "feat(storage): add integration token storage methods"
```

---

## Task 3: Create Intend API Client

**Files:**
- Create: `src/integrations/intend.ts`
- Test: `tests/integrations/intend.test.ts`

**Step 1: Write the test for intend client**

```typescript
// tests/integrations/intend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntendClient } from '../../src/integrations/intend';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IntendClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('addIntention', () => {
    it('should POST intention to intend.do API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'intention-123', text: 'buy groceries' })
      });

      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-12-31T23:59:59Z',
        baseUrl: 'https://intend.do'
      });

      const result = await client.addIntention('buy groceries');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://intend.do/api/intentions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ text: 'buy groceries' })
        })
      );
      expect(result.success).toBe(true);
    });

    it('should return auth_expired when 401 received', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const client = new IntendClient({
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        expiresAt: '2020-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.authExpired).toBe(true);
    });

    it('should return error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-12-31T23:59:59Z',
        baseUrl: 'https://intend.do'
      });

      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired token', () => {
      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2020-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      expect(client.isTokenExpired()).toBe(true);
    });

    it('should return false for valid token', () => {
      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      expect(client.isTokenExpired()).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/integrations/intend.test.ts`
Expected: FAIL - module doesn't exist

**Step 3: Implement intend client**

Create `src/integrations/intend.ts`:

```typescript
import type { IntendTokens } from '../types';

export interface IntendResult {
  success: boolean;
  data?: unknown;
  error?: string;
  authExpired?: boolean;
}

export class IntendClient {
  private tokens: IntendTokens;

  constructor(tokens: IntendTokens) {
    this.tokens = tokens;
  }

  isTokenExpired(): boolean {
    const expiresAt = new Date(this.tokens.expiresAt);
    // Add 5 minute buffer
    return expiresAt.getTime() - 5 * 60 * 1000 < Date.now();
  }

  async addIntention(text: string): Promise<IntendResult> {
    try {
      const response = await fetch(`${this.tokens.baseUrl}/api/intentions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.tokens.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });

      if (response.status === 401) {
        return { success: false, authExpired: true, error: 'Token expired or invalid' };
      }

      if (!response.ok) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: `Network error: ${error}` };
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/integrations/intend.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/integrations/intend.ts tests/integrations/intend.test.ts
git commit -m "feat(intend): add intend.do API client"
```

---

## Task 4: Create Intend Route Executor

**Files:**
- Create: `src/routes/intend-executor.ts`
- Test: `tests/routes/intend-executor.test.ts`

**Step 1: Write the test for intend executor**

```typescript
// tests/routes/intend-executor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntendExecutor } from '../../src/routes/intend-executor';
import { Storage } from '../../src/storage';
import type { Route, Capture, ParseResult } from '../../src/types';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IntendExecutor', () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockFetch.mockReset();
    mockStorage = {
      getIntendTokens: vi.fn(),
      saveIntendTokens: vi.fn(),
    } as unknown as Storage;
  });

  const createRoute = (): Route => ({
    id: 'route-intend',
    name: 'intend',
    description: 'Send intentions to intend.do',
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

  const createCapture = (): Capture => ({
    id: 'capture-1',
    raw: 'intend: buy groceries',
    timestamp: new Date().toISOString(),
    parsed: { explicitRoute: 'intend', payload: 'buy groceries', metadata: {} },
    routeProposed: 'route-intend',
    routeConfidence: 'high',
    routeFinal: 'route-intend',
    executionTrace: [],
    executionResult: 'pending',
    verificationState: 'pending',
    retiredFromTests: false,
    retiredReason: null
  });

  it('should return blocked_needs_auth when no tokens configured', async () => {
    (mockStorage.getIntendTokens as any).mockResolvedValue(null);

    const executor = new IntendExecutor(mockStorage);
    const result = await executor.execute(createRoute(), createCapture());

    expect(result.status).toBe('blocked_needs_auth');
    expect(result.error).toContain('not configured');
  });

  it('should return blocked_auth_expired when token expired', async () => {
    (mockStorage.getIntendTokens as any).mockResolvedValue({
      accessToken: 'expired',
      refreshToken: 'refresh',
      expiresAt: '2020-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    const executor = new IntendExecutor(mockStorage);
    const result = await executor.execute(createRoute(), createCapture());

    expect(result.status).toBe('blocked_auth_expired');
  });

  it('should successfully add intention when tokens valid', async () => {
    (mockStorage.getIntendTokens as any).mockResolvedValue({
      accessToken: 'valid-token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'intention-123', text: 'buy groceries' })
    });

    const executor = new IntendExecutor(mockStorage);
    const result = await executor.execute(createRoute(), createCapture());

    expect(result.status).toBe('success');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://intend.do/api/intentions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'buy groceries' })
      })
    );
  });

  it('should return blocked_auth_expired on 401 response', async () => {
    (mockStorage.getIntendTokens as any).mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    });

    const executor = new IntendExecutor(mockStorage);
    const result = await executor.execute(createRoute(), createCapture());

    expect(result.status).toBe('blocked_auth_expired');
  });

  it('should return failed on API error', async () => {
    (mockStorage.getIntendTokens as any).mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error'
    });

    const executor = new IntendExecutor(mockStorage);
    const result = await executor.execute(createRoute(), createCapture());

    expect(result.status).toBe('failed');
    expect(result.error).toContain('500');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/routes/intend-executor.test.ts`
Expected: FAIL - module doesn't exist

**Step 3: Implement intend executor**

Create `src/routes/intend-executor.ts`:

```typescript
import type { Route, Capture } from '../types';
import type { Storage } from '../storage';
import { IntendClient } from '../integrations/intend';

export interface IntendExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
  error?: string;
  data?: unknown;
}

export class IntendExecutor {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async execute(route: Route, capture: Capture): Promise<IntendExecutionResult> {
    // Get tokens
    const tokens = await this.storage.getIntendTokens();

    if (!tokens) {
      return {
        status: 'blocked_needs_auth',
        error: 'intend.do OAuth not configured. Please connect your account.'
      };
    }

    const client = new IntendClient(tokens);

    // Check token expiry
    if (client.isTokenExpired()) {
      return {
        status: 'blocked_auth_expired',
        error: 'intend.do access token has expired. Please re-authenticate.'
      };
    }

    // Extract payload
    const payload = capture.parsed?.payload || capture.raw;

    // Call API
    const result = await client.addIntention(payload);

    if (result.authExpired) {
      return {
        status: 'blocked_auth_expired',
        error: result.error
      };
    }

    if (!result.success) {
      return {
        status: 'failed',
        error: result.error
      };
    }

    return {
      status: 'success',
      data: result.data
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/routes/intend-executor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/intend-executor.ts tests/routes/intend-executor.test.ts
git commit -m "feat(intend): add intend route executor"
```

---

## Task 5: Integrate Intend Executor into Pipeline

**Files:**
- Modify: `src/routes/executor.ts`
- Modify: `src/pipeline/index.ts`
- Test: `tests/pipeline/intend-integration.test.ts`

**Step 1: Write the integration test**

```typescript
// tests/pipeline/intend-integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapturePipeline } from '../../src/pipeline';
import { Storage } from '../../src/storage';
import * as fs from 'fs';

// Mock fetch for intend.do API
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Anthropic for mastermind (won't be called in these tests)
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() }
  }
}));

describe('Pipeline Intend Integration', () => {
  let storage: Storage;
  let pipeline: CapturePipeline;
  const testDir = './test-data-pipeline-intend';
  const filestoreDir = './test-filestore-pipeline-intend';

  beforeEach(async () => {
    mockFetch.mockReset();
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(filestoreDir, { recursive: true });
    storage = new Storage(testDir);

    // Create intend route
    await storage.saveRoute({
      id: 'route-intend',
      name: 'intend',
      description: 'Send intentions to intend.do',
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

    pipeline = new CapturePipeline(storage, filestoreDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(filestoreDir, { recursive: true, force: true });
  });

  it('should block capture when intend OAuth not configured', async () => {
    const result = await pipeline.process('intend: buy groceries', 'default');

    expect(result.capture.executionResult).toBe('blocked_needs_auth');
    expect(result.capture.routeFinal).toBe('route-intend');
  });

  it('should succeed when intend OAuth configured and API works', async () => {
    // Configure OAuth
    await storage.saveIntendTokens({
      accessToken: 'valid-token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'intention-123', text: 'buy groceries' })
    });

    const result = await pipeline.process('intend: buy groceries', 'default');

    expect(result.capture.executionResult).toBe('success');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://intend.do/api/intentions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'buy groceries' })
      })
    );
  });

  it('should block capture when token expired', async () => {
    await storage.saveIntendTokens({
      accessToken: 'expired-token',
      refreshToken: 'refresh',
      expiresAt: '2020-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    const result = await pipeline.process('intend: test', 'default');

    expect(result.capture.executionResult).toBe('blocked_auth_expired');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/pipeline/intend-integration.test.ts`
Expected: FAIL - pipeline doesn't handle intend destinations

**Step 3: Modify executor.ts to support multiple destination types**

In `src/routes/executor.ts`, refactor to support destination dispatch:

```typescript
import type { Route, Capture } from '../types';
import type { Storage } from '../storage';
import { IntendExecutor, IntendExecutionResult } from './intend-executor';
// ... existing fs execution code ...

export interface ExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth' | 'blocked_auth_expired';
  error?: string;
  data?: unknown;
}

export class RouteExecutor {
  private storage: Storage;
  private filestoreDir: string;
  private intendExecutor: IntendExecutor;

  constructor(storage: Storage, filestoreDir: string) {
    this.storage = storage;
    this.filestoreDir = filestoreDir;
    this.intendExecutor = new IntendExecutor(storage);
  }

  async execute(
    route: Route,
    capture: Capture,
    username: string
  ): Promise<ExecutionResult> {
    switch (route.destinationType) {
      case 'intend':
        return this.intendExecutor.execute(route, capture);
      case 'fs':
      default:
        return this.executeFilesystem(route, capture, username);
    }
  }

  // ... move existing fs execution to executeFilesystem method ...
  private async executeFilesystem(
    route: Route,
    capture: Capture,
    username: string
  ): Promise<ExecutionResult> {
    // existing fs execution code with proper return type
  }
}
```

**Step 4: Update pipeline to use new execution result statuses**

In `src/pipeline/index.ts`, update the execute step to handle blocked states:

```typescript
// In the execute step, after getting result from executor:
if (result.status === 'blocked_needs_auth' || result.status === 'blocked_auth_expired') {
  capture.executionResult = result.status;
  addTrace(capture, 'execute', { route: route.id, payload: capture.parsed?.payload }, {
    blocked: true,
    reason: result.error
  });
  console.log(`[Pipeline] Execution blocked: ${result.status} - ${result.error}`);
} else if (result.status === 'success') {
  capture.executionResult = 'success';
  // ... existing success handling ...
} else {
  capture.executionResult = 'failed';
  // ... existing failure handling ...
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm test tests/pipeline/intend-integration.test.ts`
Expected: PASS

**Step 6: Run all tests to check for regressions**

Run: `pnpm test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/routes/executor.ts src/pipeline/index.ts tests/pipeline/intend-integration.test.ts
git commit -m "feat(pipeline): integrate intend executor with destination dispatch"
```

---

## Task 6: Add OAuth Endpoints to Server

**Files:**
- Modify: `src/server/index.ts`
- Create: `src/server/oauth.ts`
- Test: `tests/server/oauth.test.ts`

**Step 1: Write the test for OAuth endpoints**

```typescript
// tests/server/oauth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import * as fs from 'fs';
import { Storage } from '../../src/storage';
import { buildOAuthRoutes } from '../../src/server/oauth';

// Mock fetch for token exchange
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OAuth Endpoints', () => {
  let app: ReturnType<typeof Fastify>;
  let storage: Storage;
  const testDir = './test-data-oauth';

  beforeEach(async () => {
    mockFetch.mockReset();
    fs.mkdirSync(testDir, { recursive: true });
    storage = new Storage(testDir);

    app = Fastify();
    buildOAuthRoutes(app, storage, {
      intendClientId: 'test-client-id',
      intendClientSecret: 'test-client-secret',
      intendBaseUrl: 'https://intend.do',
      callbackBaseUrl: 'http://localhost:3333'
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('GET /connect/intend', () => {
    it('should redirect to intend.do OAuth authorize URL', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/connect/intend'
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('https://intend.do/oauth/authorize');
      expect(response.headers.location).toContain('client_id=test-client-id');
      expect(response.headers.location).toContain('redirect_uri=');
    });
  });

  describe('GET /oauth/callback/intend', () => {
    it('should exchange code for tokens and store them', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        })
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend?code=auth-code-123'
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('/oauth/success');

      // Verify tokens were stored
      const tokens = await storage.getIntendTokens();
      expect(tokens?.accessToken).toBe('new-access-token');
      expect(tokens?.refreshToken).toBe('new-refresh-token');
    });

    it('should handle token exchange failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend?code=bad-code'
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('/oauth/error');
    });

    it('should handle missing code parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend'
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /auth/status/intend', () => {
    it('should return connected false when no tokens', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend?token=dev-token'
      });

      const body = JSON.parse(response.body);
      expect(body.connected).toBe(false);
    });

    it('should return connected true when tokens exist', async () => {
      await storage.saveIntendTokens({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend?token=dev-token'
      });

      const body = JSON.parse(response.body);
      expect(body.connected).toBe(true);
    });
  });

  describe('POST /disconnect/intend', () => {
    it('should clear tokens', async () => {
      await storage.saveIntendTokens({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.inject({
        method: 'POST',
        url: '/disconnect/intend?token=dev-token'
      });

      expect(response.statusCode).toBe(200);

      const tokens = await storage.getIntendTokens();
      expect(tokens).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/server/oauth.test.ts`
Expected: FAIL - module doesn't exist

**Step 3: Implement OAuth routes**

Create `src/server/oauth.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { Storage } from '../storage';

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
          <h1>✓ Connected to ${integration || 'integration'}</h1>
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
          <h1>✗ Connection Failed</h1>
          <p>Reason: ${reason || 'unknown'}</p>
          <p><a href="/connect/intend">Try again</a></p>
        </body>
      </html>
    `;
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/server/oauth.test.ts`
Expected: PASS

**Step 5: Integrate OAuth routes into main server**

In `src/server/index.ts`, add:

```typescript
import { buildOAuthRoutes } from './oauth';

// In buildServer function, after other routes:
buildOAuthRoutes(app, storage, {
  intendClientId: process.env.INTEND_CLIENT_ID || '',
  intendClientSecret: process.env.INTEND_CLIENT_SECRET || '',
  intendBaseUrl: process.env.INTEND_BASE_URL || 'https://intend.do',
  callbackBaseUrl: process.env.CALLBACK_BASE_URL || 'http://localhost:3333'
});
```

**Step 6: Run all tests**

Run: `pnpm test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/server/oauth.ts src/server/index.ts tests/server/oauth.test.ts
git commit -m "feat(oauth): add intend.do OAuth endpoints"
```

---

## Task 7: Add Retry Blocked Captures Endpoint

**Files:**
- Modify: `src/server/index.ts`
- Test: `tests/server/retry.test.ts`

**Step 1: Write the test for retry endpoint**

```typescript
// tests/server/retry.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { buildServer } from '../../src/server';
import { Storage } from '../../src/storage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() }
  }
}));

describe('Retry Blocked Captures', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let storage: Storage;
  const testDir = './test-data-retry';
  const filestoreDir = './test-filestore-retry';

  beforeEach(async () => {
    mockFetch.mockReset();
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(filestoreDir, { recursive: true });
    storage = new Storage(testDir);

    // Create intend route
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

    // Create blocked capture
    await storage.saveCapture({
      id: 'blocked-capture-1',
      raw: 'intend: buy groceries',
      timestamp: new Date().toISOString(),
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

    app = await buildServer(storage, filestoreDir);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(filestoreDir, { recursive: true, force: true });
  });

  it('should retry blocked capture after OAuth configured', async () => {
    // Configure OAuth
    await storage.saveIntendTokens({
      accessToken: 'valid-token',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'intention-123', text: 'buy groceries' })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/retry/blocked-capture-1?token=dev-token'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.capture.executionResult).toBe('success');
  });

  it('should return 404 for non-existent capture', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/retry/non-existent?token=dev-token'
    });

    expect(response.statusCode).toBe(404);
  });

  it('should list all blocked captures', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/captures/blocked?token=dev-token'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('blocked-capture-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/server/retry.test.ts`
Expected: FAIL - endpoints don't exist

**Step 3: Implement retry endpoint**

In `src/server/index.ts`, add:

```typescript
// POST /retry/:captureId - retry a blocked capture
app.post('/retry/:captureId', { preHandler: authMiddleware }, async (request, reply) => {
  const { captureId } = request.params as { captureId: string };

  const capture = await storage.getCapture(captureId);
  if (!capture) {
    return reply.status(404).send({ error: 'Capture not found' });
  }

  if (capture.executionResult !== 'blocked_needs_auth' &&
      capture.executionResult !== 'blocked_auth_expired') {
    return reply.status(400).send({
      error: 'Capture is not blocked',
      currentStatus: capture.executionResult
    });
  }

  // Re-execute through pipeline
  const result = await pipeline.retryCapture(capture);
  return { capture: result.capture };
});

// GET /captures/blocked - list blocked captures
app.get('/captures/blocked', { preHandler: authMiddleware }, async (request, reply) => {
  const blocked = await storage.listCapturesNeedingAuth();
  return blocked;
});
```

**Step 4: Add retryCapture method to pipeline**

In `src/pipeline/index.ts`, add:

```typescript
async retryCapture(capture: Capture): Promise<{ capture: Capture }> {
  // Re-execute with existing route
  const route = await this.storage.getRoute(capture.routeFinal!);
  if (!route) {
    capture.executionResult = 'failed';
    capture.executionTrace.push({
      step: 'execute',
      timestamp: new Date().toISOString(),
      input: { retryAttempt: true },
      output: { error: 'Route no longer exists' },
      codeVersion: '1.0.0',
      durationMs: 0
    });
    await this.storage.saveCapture(capture, 'default');
    return { capture };
  }

  const startTime = Date.now();
  const result = await this.executor.execute(route, capture, 'default');

  capture.executionResult = result.status;
  capture.executionTrace.push({
    step: 'execute',
    timestamp: new Date().toISOString(),
    input: { route: route.id, payload: capture.parsed?.payload, retryAttempt: true },
    output: result,
    codeVersion: '1.0.0',
    durationMs: Date.now() - startTime
  });

  await this.storage.saveCapture(capture, 'default');

  if (result.status === 'success') {
    // Update route's recentItems
    route.recentItems = [
      { captureId: capture.id, timestamp: capture.timestamp },
      ...route.recentItems.slice(0, 4)
    ];
    route.lastUsed = capture.timestamp;
    await this.storage.saveRoute(route);
  }

  return { capture };
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm test tests/server/retry.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/server/index.ts src/pipeline/index.ts tests/server/retry.test.ts
git commit -m "feat(server): add retry blocked captures endpoint"
```

---

## Task 8: E2E Playwright Test with Test Credentials

**Files:**
- Create: `tests/e2e/intend-oauth.spec.ts`

**Step 1: Write E2E test**

```typescript
// tests/e2e/intend-oauth.spec.ts
import { test, expect } from '@playwright/test';

// Test credentials from spec: username qtess, password q, auth_token 4yzflqxhxjjlwhfr06va
const TEST_INTEND_URL = process.env.INTEND_TEST_URL || 'https://intend.do';
const TEST_USERNAME = 'qtess';
const TEST_PASSWORD = 'q';

test.describe('intend.do OAuth Integration', () => {

  test.beforeEach(async ({ request }) => {
    // Clear any existing intend tokens
    await request.post('http://localhost:3333/disconnect/intend?token=dev-token');
  });

  test('complete OAuth flow and route capture', async ({ page, request }) => {
    // 1. Start OAuth flow
    await page.goto('http://localhost:3333/connect/intend');

    // 2. Should redirect to intend.do login
    await expect(page).toHaveURL(/intend\.do/);

    // 3. Log in with test credentials
    await page.fill('input[name="username"], input[type="text"]', TEST_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"], input[type="submit"]');

    // 4. Approve OAuth (if approval screen shown)
    const approveButton = page.locator('button:has-text("Approve"), button:has-text("Allow")');
    if (await approveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveButton.click();
    }

    // 5. Should redirect back to success page
    await expect(page).toHaveURL(/localhost:3333.*oauth\/success/);
    await expect(page.locator('body')).toContainText('Connected');

    // 6. Verify auth status shows connected
    const statusResponse = await request.get('http://localhost:3333/auth/status/intend?token=dev-token');
    const status = await statusResponse.json();
    expect(status.connected).toBe(true);

    // 7. Send a capture to intend route
    const captureResponse = await request.post('http://localhost:3333/capture?token=dev-token', {
      data: { text: 'intend: prepare amazon returns for tomorrow morning' }
    });
    const captureResult = await captureResponse.json();
    expect(captureResult.status).toBe('success');

    // 8. Verify capture executed successfully
    const captureStatusResponse = await request.get(
      `http://localhost:3333/status/${captureResult.captureId}?token=dev-token`
    );
    const capture = await captureStatusResponse.json();
    expect(capture.executionResult).toBe('success');
  });

  test('capture blocked when OAuth not configured', async ({ request }) => {
    // 1. Clear tokens (done in beforeEach)

    // 2. Verify not connected
    const statusResponse = await request.get('http://localhost:3333/auth/status/intend?token=dev-token');
    const status = await statusResponse.json();
    expect(status.connected).toBe(false);

    // 3. Send capture - should be blocked
    const captureResponse = await request.post('http://localhost:3333/capture?token=dev-token', {
      data: { text: 'intend: buy groceries' }
    });
    const captureResult = await captureResponse.json();

    // 4. Verify blocked
    const captureStatusResponse = await request.get(
      `http://localhost:3333/status/${captureResult.captureId}?token=dev-token`
    );
    const capture = await captureStatusResponse.json();
    expect(capture.executionResult).toBe('blocked_needs_auth');
  });

  test('blocked capture retryable after OAuth', async ({ page, request }) => {
    // 1. Create blocked capture first
    const captureResponse = await request.post('http://localhost:3333/capture?token=dev-token', {
      data: { text: 'intend: test retry functionality' }
    });
    const captureResult = await captureResponse.json();
    const captureId = captureResult.captureId;

    // Verify blocked
    let statusResp = await request.get(`http://localhost:3333/status/${captureId}?token=dev-token`);
    let capture = await statusResp.json();
    expect(capture.executionResult).toBe('blocked_needs_auth');

    // 2. Complete OAuth flow
    await page.goto('http://localhost:3333/connect/intend');
    await expect(page).toHaveURL(/intend\.do/);
    await page.fill('input[name="username"], input[type="text"]', TEST_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"], input[type="submit"]');

    const approveButton = page.locator('button:has-text("Approve"), button:has-text("Allow")');
    if (await approveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveButton.click();
    }

    await expect(page).toHaveURL(/localhost:3333.*oauth\/success/);

    // 3. Retry blocked capture
    const retryResponse = await request.post(
      `http://localhost:3333/retry/${captureId}?token=dev-token`
    );
    const retryResult = await retryResponse.json();
    expect(retryResult.capture.executionResult).toBe('success');

    // 4. Verify in blocked list is now empty
    const blockedResponse = await request.get('http://localhost:3333/captures/blocked?token=dev-token');
    const blocked = await blockedResponse.json();
    const stillBlocked = blocked.filter((c: any) => c.id === captureId);
    expect(stillBlocked.length).toBe(0);
  });
});
```

**Step 2: Update playwright.config.ts if needed**

Ensure the config has proper base URL and webServer configuration:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3333',
  },
  webServer: {
    command: 'pnpm start',
    port: 3333,
    reuseExistingServer: !process.env.CI,
  },
});
```

**Step 3: Run E2E tests (requires intend.do test server)**

Run: `pnpm test:e2e`
Expected: Tests pass with test credentials

Note: E2E tests require intend.do server to be accessible with test credentials. For CI, you may need to mock the external OAuth server or skip these tests.

**Step 4: Commit**

```bash
git add tests/e2e/intend-oauth.spec.ts playwright.config.ts
git commit -m "test(e2e): add intend.do OAuth flow Playwright tests"
```

---

## Task 9: Update .env.example and Documentation

**Files:**
- Modify: `.env.example` (create if not exists)
- Modify: `CLAUDE.md` or add to docs

**Step 1: Create/update .env.example**

```bash
# Existing
ANTHROPIC_API_KEY=your-api-key
PORT=3333
DATA_DIR=./data
FILESTORE_DIR=./filestore

# intend.do OAuth (Phase 2)
[use dynamic oauth with well-known]
INTEND_BASE_URL=https://intend.do
CALLBACK_BASE_URL=http://localhost:3333

# For E2E tests with test credentials
INTEND_TEST_URL=https://intend.do
```

**Step 2: Add Phase 2 completion note to SPEC_LATER.md**

Update the success criteria to checked:

```markdown
### Phase 2
- [x] intend.do OAuth flow works end-to-end
- [x] Captures can route to intend.do and create intentions
- [x] Blocked-needs-auth state works correctly
- [x] Playwright tests cover OAuth flow with test credentials
```

**Step 3: Commit**

```bash
git add .env.example SPEC_LATER.md
git commit -m "docs: update env example and mark Phase 2 complete"
```

---

## Task 10: Final Integration Test and Commit

**Step 1: Run full test suite**

```bash
pnpm test
```
Expected: All unit tests pass

**Step 2: Start server and manual smoke test**

```bash
pnpm start
```

Test manually:
1. Visit http://localhost:3333/connect/intend - should redirect to intend.do
2. Check http://localhost:3333/auth/status/intend?token=dev-token - should show connected: false
3. Send capture without auth: `curl -X POST "http://localhost:3333/capture?token=dev-token" -H "Content-Type: application/json" -d '{"text": "intend: test"}'`
4. Verify capture is blocked_needs_auth

**Step 3: Run E2E tests (if intend.do accessible)**

```bash
pnpm test:e2e
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 2 - intend.do OAuth integration

- Add blocked_needs_auth and blocked_auth_expired execution states
- Add intend destination type with OAuth token storage
- Create IntendClient for API calls
- Create IntendExecutor for route execution
- Add /connect/intend OAuth initiation endpoint
- Add /oauth/callback/intend for token exchange
- Add /auth/status/intend and /disconnect/intend endpoints
- Add /retry/:captureId for retrying blocked captures
- Add /captures/blocked for listing blocked captures
- Full test coverage including Playwright E2E tests

Phase 2 success criteria met:
- intend.do OAuth flow works end-to-end
- Captures can route to intend.do and create intentions
- Blocked-needs-auth state works correctly
- Playwright tests cover OAuth flow with test credentials"
```

---

Plan complete and saved to `docs/plans/2026-01-22-phase2-intend-oauth.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
