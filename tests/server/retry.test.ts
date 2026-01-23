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

    app = await buildServer(storage, filestoreDir, 'test-api-key');
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(filestoreDir, { recursive: true, force: true });
  });

  it('should retry blocked capture after OAuth configured', async () => {
    // Configure OAuth for 'default' user (matches the capture's username)
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

  it('should return 400 when capture is not blocked', async () => {
    // Create a non-blocked capture
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

    const response = await app.inject({
      method: 'POST',
      url: '/retry/success-capture?token=dev-token'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('not blocked');
  });
});
