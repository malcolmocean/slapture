// tests/routes/intend-executor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { IntendExecutor } from '../../src/routes/intend-executor';
import { Storage } from '../../src/storage';
import type { Route, Capture } from '../../src/types';

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
    retiredReason: null,
    username: 'default'
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
    // API format: POST /api/v0/u/me/intentions with { raw: "X) text" }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://intend.do/api/v0/u/me/intentions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ raw: '&) buy groceries' })
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
