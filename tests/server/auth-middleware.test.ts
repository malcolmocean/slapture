import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { StorageInterface } from '../../src/storage/interface.js';

// Mock firebase-admin/auth before importing auth module
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: vi.fn(),
  }),
}));

describe('Auth middleware', () => {
  it('should return 401 when no auth is provided', async () => {
    const { createAuthMiddleware } = await import('../../src/server/auth.js');

    const mockStorage = {
      getConfig: vi.fn().mockResolvedValue({ authToken: 'old-token' }),
      getApiKeyIndex: vi.fn().mockResolvedValue(null),
      getApiKey: vi.fn().mockResolvedValue(null),
      getUser: vi.fn().mockResolvedValue(null),
      updateApiKey: vi.fn(),
    } as unknown as StorageInterface;

    const app = new Hono();
    app.use('*', createAuthMiddleware(mockStorage, { publicPaths: ['/public'] }));
    app.get('/protected', (c) => c.json({ ok: true }));

    const res = await app.request('/protected');
    expect(res.status).toBe(401);
  });

  it('should allow public paths without auth', async () => {
    const { createAuthMiddleware } = await import('../../src/server/auth.js');

    const mockStorage = {} as unknown as StorageInterface;

    const app = new Hono();
    app.use('*', createAuthMiddleware(mockStorage, { publicPaths: ['/public', '/login'] }));
    app.get('/public', (c) => c.json({ ok: true }));

    const res = await app.request('/public');
    expect(res.status).toBe(200);
  });

  it('should authenticate with valid API key', async () => {
    const { createAuthMiddleware } = await import('../../src/server/auth.js');
    const bcrypt = await import('bcryptjs');
    const rawKey = 'slap_k_' + 'a'.repeat(40);
    const keyHash = await bcrypt.hash(rawKey, 10);

    // Compute SHA-256 index key the same way the middleware does
    const crypto = await import('crypto');
    const indexKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    const mockStorage = {
      getApiKeyIndex: vi.fn().mockImplementation((hash: string) => {
        if (hash === indexKey) return Promise.resolve({ uid: 'user-1', keyId: 'key-1' });
        return Promise.resolve(null);
      }),
      getApiKey: vi.fn().mockResolvedValue({
        id: 'key-1',
        name: 'Test',
        keyHash,
        prefix: 'slap_k_aaaa',
        temporary: false,
        createdAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
        lastUsedAt: null,
        status: 'active',
      }),
      getUser: vi.fn().mockResolvedValue({
        uid: 'user-1',
        email: 'test@example.com',
        displayName: 'Test',
        createdAt: '2026-01-01T00:00:00Z',
        authProvider: 'email',
      }),
      updateApiKey: vi.fn().mockResolvedValue(undefined),
    } as unknown as StorageInterface;

    const app = new Hono();
    app.use('*', createAuthMiddleware(mockStorage, { publicPaths: [] }));
    app.get('/protected', (c) => {
      const auth = c.get('auth');
      return c.json({ uid: auth.uid });
    });

    const res = await app.request('/protected', {
      headers: { 'X-API-Key': rawKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uid).toBe('user-1');
  });

  it('should reject expired API key', async () => {
    const { createAuthMiddleware } = await import('../../src/server/auth.js');
    const bcrypt = await import('bcryptjs');
    const rawKey = 'slap_t_' + 'b'.repeat(40);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const crypto = await import('crypto');
    const indexKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    const mockStorage = {
      getApiKeyIndex: vi.fn().mockImplementation((hash: string) => {
        if (hash === indexKey) return Promise.resolve({ uid: 'user-1', keyId: 'key-2' });
        return Promise.resolve(null);
      }),
      getApiKey: vi.fn().mockResolvedValue({
        id: 'key-2',
        name: 'Expired',
        keyHash,
        prefix: 'slap_t_bbbb',
        temporary: true,
        createdAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-01-02T00:00:00Z',  // Already expired
        lastUsedAt: null,
        status: 'active',
      }),
      getUser: vi.fn(),
      updateApiKey: vi.fn(),
    } as unknown as StorageInterface;

    const app = new Hono();
    app.use('*', createAuthMiddleware(mockStorage, { publicPaths: [] }));
    app.get('/protected', (c) => c.json({ ok: true }));

    const res = await app.request('/protected', {
      headers: { 'X-API-Key': rawKey },
    });
    expect(res.status).toBe(401);
  });

  it('should reject revoked API key', async () => {
    const { createAuthMiddleware } = await import('../../src/server/auth.js');
    const bcrypt = await import('bcryptjs');
    const rawKey = 'slap_k_' + 'c'.repeat(40);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const crypto = await import('crypto');
    const indexKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    const mockStorage = {
      getApiKeyIndex: vi.fn().mockImplementation((hash: string) => {
        if (hash === indexKey) return Promise.resolve({ uid: 'user-1', keyId: 'key-3' });
        return Promise.resolve(null);
      }),
      getApiKey: vi.fn().mockResolvedValue({
        id: 'key-3',
        name: 'Revoked',
        keyHash,
        prefix: 'slap_k_cccc',
        temporary: false,
        createdAt: '2026-01-01T00:00:00Z',
        expiresAt: null,
        lastUsedAt: null,
        status: 'revoked',
      }),
      getUser: vi.fn(),
      updateApiKey: vi.fn(),
    } as unknown as StorageInterface;

    const app = new Hono();
    app.use('*', createAuthMiddleware(mockStorage, { publicPaths: [] }));
    app.get('/protected', (c) => c.json({ ok: true }));

    const res = await app.request('/protected', {
      headers: { 'X-API-Key': rawKey },
    });
    expect(res.status).toBe(401);
  });
});
