import { randomUUID, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import type { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import type { ApiKey } from '../types.js';

export function buildApiKeyRoutes(app: Hono, storage: StorageInterface): void {
  // Create API key
  app.post('/api/keys', async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json().catch(() => ({}));
    const { name, temporary = false, expiresAt = null } = body;

    if (!name || typeof name !== 'string') {
      return c.json({ error: 'name is required' }, 400);
    }

    if (temporary && !expiresAt) {
      return c.json({ error: 'expiresAt is required for temporary keys' }, 400);
    }

    // Generate the raw key
    const prefix = temporary ? 'slap_t_' : 'slap_k_';
    const randomPart = Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    const rawKey = prefix + randomPart;

    // Hash for storage (bcrypt for verification)
    const keyHash = await bcrypt.hash(rawKey, 10);

    // SHA-256 for index lookup
    const indexKey = createHash('sha256').update(rawKey).digest('hex');

    const keyId = randomUUID();
    const displayPrefix = rawKey.slice(0, 16);  // e.g. "slap_k_a1b2c3d4"

    const apiKey: ApiKey = {
      id: keyId,
      name,
      keyHash,
      prefix: displayPrefix,
      temporary,
      createdAt: new Date().toISOString(),
      expiresAt: temporary ? expiresAt : null,
      lastUsedAt: null,
      status: 'active',
    };

    await storage.saveApiKey(auth.uid, apiKey);
    await storage.saveApiKeyIndex(indexKey, auth.uid, keyId);

    // Return the raw key (only time it's ever shown)
    return c.json({
      id: keyId,
      key: rawKey,
      name,
      prefix: displayPrefix,
      temporary,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    }, 201);
  });

  // List API keys
  app.get('/api/keys', async (c) => {
    const auth = c.get('auth');
    const keys = await storage.listApiKeys(auth.uid);

    // Never expose keyHash
    const sanitized = keys.map(({ keyHash, ...rest }) => rest);
    return c.json(sanitized);
  });

  // Delete (revoke) API key
  app.delete('/api/keys/:keyId', async (c) => {
    const auth = c.get('auth');
    const keyId = c.req.param('keyId');

    const key = await storage.getApiKey(auth.uid, keyId);
    if (!key) {
      return c.json({ error: 'API key not found' }, 404);
    }

    await storage.deleteApiKey(auth.uid, keyId);
    // Note: We can't delete the index entry without the raw key.
    // The index entry will just point to a deleted key, which verifyApiKey handles.

    return c.json({ deleted: true });
  });
}
