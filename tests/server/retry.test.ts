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

// Mock Firebase auth to create a passthrough middleware for testing
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: vi.fn(),
  }),
}));

vi.mock('../../src/server/auth.js', () => ({
  createAuthMiddleware: () => async (c: any, next: any) => {
    c.set('auth', { uid: 'default', email: 'test@test.com', authMethod: 'firebase' });
    return next();
  },
}));

vi.mock('../../src/server/api-keys.js', () => ({
  buildApiKeyRoutes: () => {},
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

    const response = await app.request('/retry/blocked-capture-1', { method: 'POST' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.capture.executionResult).toBe('success');
  });

  it('should return 404 for non-existent capture', async () => {
    const response = await app.request('/retry/non-existent', { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('should list all blocked captures', async () => {
    const response = await app.request('/captures/blocked');

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

    const response = await app.request('/retry/success-capture', { method: 'POST' });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('not blocked');
  });
});
