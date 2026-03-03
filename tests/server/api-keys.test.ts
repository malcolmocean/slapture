import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { StorageInterface } from '../../src/storage/interface.js';
import type { AuthContext } from '../../src/types.js';

// Mock firebase-admin
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: vi.fn(), verifySessionCookie: vi.fn(), createSessionCookie: vi.fn().mockResolvedValue('mock-session-cookie') }),
}));

describe('API key management endpoints', () => {
  let app: Hono;
  let mockStorage: Partial<StorageInterface>;

  beforeEach(async () => {
    const { buildApiKeyRoutes } = await import('../../src/server/api-keys.js');

    mockStorage = {
      saveApiKey: vi.fn().mockResolvedValue(undefined),
      listApiKeys: vi.fn().mockResolvedValue([]),
      getApiKey: vi.fn().mockResolvedValue(null),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
      saveApiKeyIndex: vi.fn().mockResolvedValue(undefined),
      deleteApiKeyIndex: vi.fn().mockResolvedValue(undefined),
    };

    app = new Hono();

    // Simulate authenticated user
    app.use('*', async (c, next) => {
      const auth: AuthContext = {
        uid: 'test-uid',
        email: 'test@example.com',
        authMethod: 'firebase',
      };
      c.set('auth', auth);
      return next();
    });

    buildApiKeyRoutes(app, mockStorage as StorageInterface);
  });

  it('POST /api/keys should create a new key', async () => {
    const res = await app.request('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Key', temporary: false }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^slap_k_/);
    expect(body.name).toBe('My Key');
    expect(body.prefix).toBeDefined();
    expect(mockStorage.saveApiKey).toHaveBeenCalled();
    expect(mockStorage.saveApiKeyIndex).toHaveBeenCalled();
  });

  it('POST /api/keys should create temp key with expiry', async () => {
    const res = await app.request('/api/keys', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Temp Key',
        temporary: true,
        expiresAt: '2026-12-31T00:00:00Z',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^slap_t_/);
  });

  it('POST /api/keys should reject temp key without expiry', async () => {
    const res = await app.request('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad Temp', temporary: true }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
  });

  it('GET /api/keys should list keys without secrets', async () => {
    (mockStorage.listApiKeys as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'key-1',
        name: 'Test Key',
        keyHash: 'secret',
        prefix: 'slap_k_abcd',
        temporary: false,
        createdAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
        lastUsedAt: null,
        status: 'active',
      },
    ]);

    const res = await app.request('/api/keys');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].keyHash).toBeUndefined();
    expect(body[0].prefix).toBe('slap_k_abcd');
  });

  it('DELETE /api/keys/:keyId should revoke a key', async () => {
    (mockStorage.getApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'key-1',
      name: 'Test Key',
      keyHash: 'hash',
      prefix: 'slap_k_abcd',
      temporary: false,
      status: 'active',
    });

    const res = await app.request('/api/keys/key-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(mockStorage.deleteApiKey).toHaveBeenCalledWith('test-uid', 'key-1');
  });
});
