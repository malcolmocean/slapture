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

    pipeline = new CapturePipeline(storage, filestoreDir, 'test-api-key');
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
    // Configure OAuth for 'default' user (the username used by pipeline.process)
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

    const result = await pipeline.process('intend: buy groceries', 'default');

    expect(result.capture.executionResult).toBe('success');
    // API format: POST /api/v0/u/me/intentions with { raw: "X) text" }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://intend.do/api/v0/u/me/intentions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ raw: '&) buy groceries' })
      })
    );
  });

  it('should block capture when token expired', async () => {
    await storage.saveIntendTokens('default', {
      accessToken: 'expired-token',
      refreshToken: 'refresh',
      expiresAt: '2020-01-01T00:00:00Z',
      baseUrl: 'https://intend.do'
    });

    const result = await pipeline.process('intend: test', 'default');

    expect(result.capture.executionResult).toBe('blocked_auth_expired');
  });
});
