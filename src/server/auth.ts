import { getAuth } from 'firebase-admin/auth';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import type { Context, Next, MiddlewareHandler } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import type { AuthContext } from '../types.js';

// Extend Hono's context to include auth
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

interface AuthMiddlewareOptions {
  publicPaths: string[];
}

export function createAuthMiddleware(
  storage: StorageInterface,
  options: AuthMiddlewareOptions
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const pathname = new URL(c.req.url).pathname;

    // Check public paths
    for (const publicPath of options.publicPaths) {
      if (pathname === publicPath || pathname.startsWith(publicPath + '/')) {
        return next();
      }
    }

    // Try Firebase ID token (Authorization: Bearer <token>)
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const idToken = authHeader.slice(7);
      try {
        const decoded = await getAuth().verifyIdToken(idToken);
        const authCtx: AuthContext = {
          uid: decoded.uid,
          email: decoded.email || '',
          authMethod: 'firebase',
        };
        c.set('auth', authCtx);
        return next();
      } catch {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }
    }

    // Try API key (X-API-Key header)
    const apiKey = c.req.header('X-API-Key');
    if (apiKey) {
      const authCtx = await verifyApiKey(storage, apiKey);
      if (authCtx) {
        c.set('auth', authCtx);
        return next();
      }
      return c.json({ error: 'Invalid or expired API key' }, 401);
    }

    return c.json({ error: 'Authentication required' }, 401);
  };
}

async function verifyApiKey(
  storage: StorageInterface,
  rawKey: string
): Promise<AuthContext | null> {
  // SHA-256 for deterministic index lookup
  const indexKey = createHash('sha256').update(rawKey).digest('hex');

  const indexEntry = await storage.getApiKeyIndex(indexKey);
  if (!indexEntry) return null;

  const key = await storage.getApiKey(indexEntry.uid, indexEntry.keyId);
  if (!key) return null;

  // Verify the key matches (bcrypt)
  const valid = await bcrypt.compare(rawKey, key.keyHash);
  if (!valid) return null;

  // Check status
  if (key.status !== 'active') return null;

  // Check expiry
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return null;

  // Get user profile
  const user = await storage.getUser(indexEntry.uid);
  if (!user) return null;

  // Update lastUsedAt (fire-and-forget)
  key.lastUsedAt = new Date().toISOString();
  storage.updateApiKey(indexEntry.uid, key).catch(() => {});

  return {
    uid: indexEntry.uid,
    email: user.email,
    authMethod: 'api-key',
    apiKeyId: key.id,
  };
}
