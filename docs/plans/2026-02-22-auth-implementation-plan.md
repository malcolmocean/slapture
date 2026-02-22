# Firebase Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Firebase Auth (email + Google sign-in) with per-user API keys, replacing the current `?token=` auth system.

**Architecture:** Firebase Auth handles identity on client (FirebaseUI), Firebase Admin SDK verifies ID tokens server-side in Hono middleware. API keys (hashed, stored in Firestore) provide programmatic access. All data paths become uid-scoped for multi-tenancy.

**Tech Stack:** firebase-admin (server), firebase + firebaseui (client HTML pages), bcryptjs (key hashing), Hono middleware, Firestore

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install firebase-admin and bcryptjs**

Run: `pnpm add firebase-admin bcryptjs`
Run: `pnpm add -D @types/bcryptjs`

**Step 2: Verify build still works**

Run: `pnpm build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add firebase-admin and bcryptjs dependencies"
```

---

### Task 2: Add auth types

**Files:**
- Modify: `src/types.ts:268-274`

**Step 1: Write the failing test**

Create `tests/unit/auth-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { UserProfile, ApiKey, AuthContext } from '../../src/types.js';

describe('Auth types', () => {
  it('should define UserProfile with required fields', () => {
    const profile: UserProfile = {
      uid: 'firebase-uid-123',
      email: 'test@example.com',
      displayName: 'Test User',
      createdAt: '2026-02-22T00:00:00Z',
      authProvider: 'google',
    };
    expect(profile.uid).toBe('firebase-uid-123');
    expect(profile.authProvider).toBe('google');
  });

  it('should define ApiKey with required fields', () => {
    const key: ApiKey = {
      id: 'key-123',
      name: 'My CLI Key',
      keyHash: 'bcrypt-hash-here',
      prefix: 'slap_k_a1b2c3d4',
      temporary: false,
      createdAt: '2026-02-22T00:00:00Z',
      expiresAt: null,
      lastUsedAt: null,
      status: 'active',
    };
    expect(key.temporary).toBe(false);
    expect(key.expiresAt).toBeNull();
  });

  it('should define temporary ApiKey with expiry', () => {
    const key: ApiKey = {
      id: 'key-456',
      name: 'Temp Key',
      keyHash: 'bcrypt-hash-here',
      prefix: 'slap_t_e5f6g7h8',
      temporary: true,
      createdAt: '2026-02-22T00:00:00Z',
      expiresAt: '2026-03-22T00:00:00Z',
      lastUsedAt: null,
      status: 'active',
    };
    expect(key.temporary).toBe(true);
    expect(key.expiresAt).not.toBeNull();
  });

  it('should define AuthContext resolved from either auth method', () => {
    const ctx: AuthContext = {
      uid: 'firebase-uid-123',
      email: 'test@example.com',
      authMethod: 'firebase',
    };
    expect(ctx.authMethod).toBe('firebase');

    const apiCtx: AuthContext = {
      uid: 'firebase-uid-123',
      email: 'test@example.com',
      authMethod: 'api-key',
      apiKeyId: 'key-123',
    };
    expect(apiCtx.authMethod).toBe('api-key');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/auth-types.test.ts`
Expected: FAIL — types don't exist yet

**Step 3: Write the types**

Add to end of `src/types.ts` (after line 274):

```typescript
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  createdAt: string;  // ISO 8601
  authProvider: 'email' | 'google';
}

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;       // e.g. "slap_k_a1b2c3d4" or "slap_t_e5f6g7h8"
  temporary: boolean;
  createdAt: string;     // ISO 8601
  expiresAt: string | null;  // null = never (permanent only)
  lastUsedAt: string | null;
  status: 'active' | 'revoked';
}

export interface AuthContext {
  uid: string;
  email: string;
  authMethod: 'firebase' | 'api-key';
  apiKeyId?: string;  // Set when authMethod is 'api-key'
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/auth-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts tests/unit/auth-types.test.ts
git commit -m "feat: add UserProfile, ApiKey, and AuthContext types"
```

---

### Task 3: Add user and API key methods to StorageInterface

**Files:**
- Modify: `src/storage/interface.ts:5-61`
- Modify: `src/storage/firestore.ts`
- Modify: `src/storage/index.ts` (local storage — stub with NotImplementedError for now)

**Step 1: Write the failing test**

Create `tests/unit/auth-storage.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FirestoreStorage } from '../../src/storage/firestore.js';
import type { UserProfile, ApiKey } from '../../src/types.js';

// This test requires Firestore emulator running
// FIRESTORE_EMULATOR_HOST=localhost:8081
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!EMULATOR_HOST)('Auth storage (Firestore)', () => {
  let storage: FirestoreStorage;

  beforeAll(() => {
    storage = new FirestoreStorage('test-project');
  });

  describe('User management', () => {
    it('should save and retrieve a user profile', async () => {
      const profile: UserProfile = {
        uid: 'test-uid-1',
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: '2026-02-22T00:00:00Z',
        authProvider: 'google',
      };

      await storage.saveUser(profile);
      const retrieved = await storage.getUser('test-uid-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.email).toBe('test@example.com');
      expect(retrieved!.authProvider).toBe('google');
    });

    it('should return null for nonexistent user', async () => {
      const result = await storage.getUser('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('API key management', () => {
    const testKey: ApiKey = {
      id: 'key-test-1',
      name: 'Test Key',
      keyHash: '$2b$10$fakehashfortest',
      prefix: 'slap_k_abcd1234',
      temporary: false,
      createdAt: '2026-02-22T00:00:00Z',
      expiresAt: null,
      lastUsedAt: null,
      status: 'active',
    };

    it('should save and list API keys for a user', async () => {
      await storage.saveApiKey('test-uid-1', testKey);
      const keys = await storage.listApiKeys('test-uid-1');

      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('Test Key');
    });

    it('should save and retrieve API key index entry', async () => {
      await storage.saveApiKeyIndex(testKey.keyHash, 'test-uid-1', testKey.id);
      const entry = await storage.getApiKeyIndex(testKey.keyHash);

      expect(entry).not.toBeNull();
      expect(entry!.uid).toBe('test-uid-1');
      expect(entry!.keyId).toBe('key-test-1');
    });

    it('should return null for nonexistent key index', async () => {
      const result = await storage.getApiKeyIndex('nonexistent-hash');
      expect(result).toBeNull();
    });

    it('should delete API key and its index', async () => {
      await storage.deleteApiKey('test-uid-1', testKey.id);
      await storage.deleteApiKeyIndex(testKey.keyHash);

      const keys = await storage.listApiKeys('test-uid-1');
      expect(keys).toHaveLength(0);

      const index = await storage.getApiKeyIndex(testKey.keyHash);
      expect(index).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/auth-storage.test.ts`
Expected: FAIL — methods don't exist

**Step 3: Add methods to StorageInterface**

Add to `src/storage/interface.ts` (after line 59, before the closing `}`):

```typescript
  // User management
  saveUser(profile: UserProfile): Promise<void>;
  getUser(uid: string): Promise<UserProfile | null>;

  // API key management
  saveApiKey(uid: string, key: ApiKey): Promise<void>;
  listApiKeys(uid: string): Promise<ApiKey[]>;
  getApiKey(uid: string, keyId: string): Promise<ApiKey | null>;
  updateApiKey(uid: string, key: ApiKey): Promise<void>;
  deleteApiKey(uid: string, keyId: string): Promise<void>;

  // API key index (for fast lookup by hash)
  saveApiKeyIndex(keyHash: string, uid: string, keyId: string): Promise<void>;
  getApiKeyIndex(keyHash: string): Promise<{ uid: string; keyId: string } | null>;
  deleteApiKeyIndex(keyHash: string): Promise<void>;
```

Update the import line at top of `src/storage/interface.ts` to include the new types:

```typescript
import type { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, TriggerChangeReview, UserProfile, ApiKey } from '../types.js';
```

**Step 4: Implement in FirestoreStorage**

Add to `src/storage/firestore.ts` (before the closing `}`):

```typescript
  // User management
  async saveUser(profile: UserProfile): Promise<void> {
    await this.db.collection('users').doc(profile.uid).set(profile, { merge: true });
  }

  async getUser(uid: string): Promise<UserProfile | null> {
    const doc = await this.db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data?.email) return null;  // Legacy user doc without profile
    return data as UserProfile;
  }

  // API key management
  async saveApiKey(uid: string, key: ApiKey): Promise<void> {
    await this.db.collection('users').doc(uid).collection('apiKeys').doc(key.id).set(key);
  }

  async listApiKeys(uid: string): Promise<ApiKey[]> {
    const snapshot = await this.db.collection('users').doc(uid).collection('apiKeys').get();
    return snapshot.docs.map(doc => doc.data() as ApiKey);
  }

  async getApiKey(uid: string, keyId: string): Promise<ApiKey | null> {
    const doc = await this.db.collection('users').doc(uid).collection('apiKeys').doc(keyId).get();
    if (!doc.exists) return null;
    return doc.data() as ApiKey;
  }

  async updateApiKey(uid: string, key: ApiKey): Promise<void> {
    await this.db.collection('users').doc(uid).collection('apiKeys').doc(key.id).set(key);
  }

  async deleteApiKey(uid: string, keyId: string): Promise<void> {
    await this.db.collection('users').doc(uid).collection('apiKeys').doc(keyId).delete();
  }

  // API key index
  async saveApiKeyIndex(keyHash: string, uid: string, keyId: string): Promise<void> {
    await this.db.collection('apiKeyIndex').doc(keyHash).set({ uid, keyId });
  }

  async getApiKeyIndex(keyHash: string): Promise<{ uid: string; keyId: string } | null> {
    const doc = await this.db.collection('apiKeyIndex').doc(keyHash).get();
    if (!doc.exists) return null;
    return doc.data() as { uid: string; keyId: string };
  }

  async deleteApiKeyIndex(keyHash: string): Promise<void> {
    await this.db.collection('apiKeyIndex').doc(keyHash).delete();
  }
```

**Step 5: Add stubs to local Storage**

Add to `src/storage/index.ts` — stub methods that throw so the interface is satisfied:

```typescript
  // User management (not supported in local mode)
  async saveUser(_profile: UserProfile): Promise<void> {
    throw new Error('User management requires Firestore backend');
  }
  async getUser(_uid: string): Promise<UserProfile | null> {
    throw new Error('User management requires Firestore backend');
  }
  async saveApiKey(_uid: string, _key: ApiKey): Promise<void> {
    throw new Error('API key management requires Firestore backend');
  }
  async listApiKeys(_uid: string): Promise<ApiKey[]> {
    throw new Error('API key management requires Firestore backend');
  }
  async getApiKey(_uid: string, _keyId: string): Promise<ApiKey | null> {
    throw new Error('API key management requires Firestore backend');
  }
  async updateApiKey(_uid: string, _key: ApiKey): Promise<void> {
    throw new Error('API key management requires Firestore backend');
  }
  async deleteApiKey(_uid: string, _keyId: string): Promise<void> {
    throw new Error('API key management requires Firestore backend');
  }
  async saveApiKeyIndex(_keyHash: string, _uid: string, _keyId: string): Promise<void> {
    throw new Error('API key index requires Firestore backend');
  }
  async getApiKeyIndex(_keyHash: string): Promise<{ uid: string; keyId: string } | null> {
    throw new Error('API key index requires Firestore backend');
  }
  async deleteApiKeyIndex(_keyHash: string): Promise<void> {
    throw new Error('API key index requires Firestore backend');
  }
```

Add imports for `UserProfile` and `ApiKey` to local storage file.

**Step 6: Verify build compiles**

Run: `pnpm build`
Expected: Clean compilation

**Step 7: Run all tests to ensure no regressions**

Run: `pnpm vitest run`
Expected: All existing tests still pass

**Step 8: Commit**

```bash
git add src/storage/interface.ts src/storage/firestore.ts src/storage/index.ts tests/unit/auth-storage.test.ts
git commit -m "feat: add user and API key storage methods to StorageInterface"
```

---

### Task 4: Create Firebase Auth middleware

**Files:**
- Create: `src/server/auth.ts`
- Modify: `src/server/index.ts:11-46`

**Step 1: Write the failing test**

Create `tests/server/auth-middleware.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { StorageInterface } from '../../src/storage/interface.js';

// Mock firebase-admin before importing auth module
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: vi.fn(),
  }),
}));

describe('Auth middleware', () => {
  // We'll test the middleware by building a minimal Hono app that uses it.
  // The actual middleware implementation will be in src/server/auth.ts.

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

    const mockStorage = {
      getApiKeyIndex: vi.fn().mockResolvedValue({ uid: 'user-1', keyId: 'key-1' }),
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
      updateApiKey: vi.fn(),
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

    const mockStorage = {
      getApiKeyIndex: vi.fn().mockResolvedValue({ uid: 'user-1', keyId: 'key-2' }),
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

    const mockStorage = {
      getApiKeyIndex: vi.fn().mockResolvedValue({ uid: 'user-1', keyId: 'key-3' }),
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server/auth-middleware.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement the auth middleware**

Create `src/server/auth.ts`:

```typescript
import { getAuth } from 'firebase-admin/auth';
import bcrypt from 'bcryptjs';
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
  // Look up by trying to find matching hash in index
  // We need to hash the key and look it up — but bcrypt hashes aren't deterministic.
  // So we use a SHA-256 hash of the key as the index key, and bcrypt for verification.
  const crypto = await import('crypto');
  const indexKey = crypto.createHash('sha256').update(rawKey).digest('hex');

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
```

**Important note on key indexing:** The `apiKeyIndex` collection uses a SHA-256 hash of the raw key as the document ID (deterministic, for lookup). The `keyHash` field in the ApiKey document uses bcrypt (for secure verification). This is a two-layer approach: SHA-256 for finding, bcrypt for verifying.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server/auth-middleware.test.ts`
Expected: PASS

Note: The test mocks `firebase-admin/auth` so Firebase tests pass without an emulator. The API key tests use real bcrypt.

**Step 5: Commit**

```bash
git add src/server/auth.ts tests/server/auth-middleware.test.ts
git commit -m "feat: add Firebase Auth + API key middleware"
```

---

### Task 5: Initialize Firebase Admin SDK in entrypoint

**Files:**
- Modify: `src/index.ts:1-58`

**Step 1: Add Firebase Admin initialization**

Modify `src/index.ts` to initialize Firebase Admin SDK before building the server. Add after the imports:

```typescript
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
```

Add initialization in the `main()` function, after the `ANTHROPIC_API_KEY` check (line 22) but before storage setup (line 24):

```typescript
  // Initialize Firebase Admin SDK
  if (STORAGE_BACKEND === 'firestore') {
    // On Cloud Run, use application default credentials
    // Locally, use GOOGLE_APPLICATION_CREDENTIALS env var
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('[Auth] Firebase Admin SDK initialized');
  }
```

**Step 2: Verify build compiles**

Run: `pnpm build`
Expected: Clean compilation

**Step 3: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass (Firebase init only happens in firestore mode)

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: initialize Firebase Admin SDK in entrypoint"
```

---

### Task 6: Wire auth middleware into server

**Files:**
- Modify: `src/server/index.ts:1-153`

**Step 1: Write the failing test**

Update `tests/unit/server.test.ts` to account for new auth. The existing tests use `?token=` which will no longer work. We need to update them to use the new auth system.

But first — the server needs to support both modes:
- When `STORAGE_BACKEND=firestore`: use Firebase Auth middleware
- When local: keep the `?token=` system (since Firebase Admin isn't initialized)

Add a `useFirebaseAuth` parameter to `buildServer`:

**Step 2: Modify buildServer signature and middleware**

In `src/server/index.ts`, change the function signature:

```typescript
export async function buildServer(
  storage: StorageInterface,
  filestoreRoot: string,
  apiKey: string,
  sheetsAuthProvider?: SheetsAuthProvider,
  useFirebaseAuth: boolean = false,
): Promise<Hono> {
```

Replace the auth middleware block (lines 21-46) with:

```typescript
  if (useFirebaseAuth) {
    // Firebase Auth + API key middleware
    const { createAuthMiddleware } = await import('./auth.js');
    app.use('*', createAuthMiddleware(storage, {
      publicPaths: ['/', '/login', '/signup', '/widget'],
    }));
  } else {
    // Legacy token-based auth for local development
    app.use('*', async (c, next) => {
      const pathname = new URL(c.req.url).pathname;
      if (pathname === '/widget' || pathname.startsWith('/widget/') ||
          pathname.startsWith('/connect/') || pathname.startsWith('/oauth/') ||
          pathname.startsWith('/auth/status/') || pathname.startsWith('/disconnect/')) {
        return next();
      }
      const token = c.req.query('token');
      const config = await storage.getConfig();
      if (token !== config.authToken) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      return next();
    });
  }
```

Update `src/index.ts` to pass `useFirebaseAuth`:

```typescript
  const useFirebaseAuth = STORAGE_BACKEND === 'firestore';
  const app = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY, sheetsAuthProvider, useFirebaseAuth);
```

In the capture endpoint, when using Firebase auth, get the uid from auth context instead of request body:

```typescript
  app.post('/capture', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { text } = body;
    // Use authenticated uid if available, fall back to body username for legacy mode
    const username = c.get('auth')?.uid ?? body.username ?? 'default';
    ...
  });
```

**Step 3: Verify existing tests still pass**

Run: `pnpm vitest run tests/unit/server.test.ts`
Expected: PASS (local mode still uses ?token=)

**Step 4: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass

**Step 5: Build check**

Run: `pnpm build`
Expected: Clean

**Step 6: Commit**

```bash
git add src/server/index.ts src/index.ts
git commit -m "feat: wire Firebase Auth middleware into server with legacy fallback"
```

---

### Task 7: Create API key management endpoints

**Files:**
- Create: `src/server/api-keys.ts`

**Step 1: Write the failing test**

Create `tests/server/api-keys.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { StorageInterface } from '../../src/storage/interface.js';
import type { AuthContext } from '../../src/types.js';

// Mock firebase-admin
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: vi.fn() }),
}));

describe('API key management endpoints', () => {
  let app: Hono;
  let mockStorage: Partial<StorageInterface>;

  beforeEach(async () => {
    const { buildApiKeyRoutes } = await import('../../src/server/api-keys.js');

    mockStorage = {
      saveApiKey: vi.fn(),
      listApiKeys: vi.fn().mockResolvedValue([]),
      getApiKey: vi.fn().mockResolvedValue(null),
      deleteApiKey: vi.fn(),
      saveApiKeyIndex: vi.fn(),
      deleteApiKeyIndex: vi.fn(),
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server/api-keys.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement API key routes**

Create `src/server/api-keys.ts`:

```typescript
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
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

    // Delete the key and its index
    const indexKey = createHash('sha256').update('').digest('hex');  // Can't reconstruct — delete by key doc
    await storage.deleteApiKey(auth.uid, keyId);
    // Note: We can't delete the index entry without the raw key.
    // The index entry will just point to a deleted key, which verifyApiKey handles.

    return c.json({ deleted: true });
  });
}
```

**Step 4: Run tests**

Run: `pnpm vitest run tests/server/api-keys.test.ts`
Expected: PASS

**Step 5: Wire into server**

Add to `src/server/index.ts`, after the OAuth routes (line 147):

```typescript
  // API key management routes (only in Firebase auth mode)
  if (useFirebaseAuth) {
    const { buildApiKeyRoutes } = await import('./api-keys.js');
    buildApiKeyRoutes(app, storage);
  }
```

**Step 6: Build and test**

Run: `pnpm build`
Run: `pnpm vitest run`
Expected: All pass

**Step 7: Commit**

```bash
git add src/server/api-keys.ts tests/server/api-keys.test.ts src/server/index.ts
git commit -m "feat: add API key management endpoints (create, list, revoke)"
```

---

### Task 8: Create public pages (landing, login, signup)

**Files:**
- Create: `src/pages/landing.ts`
- Create: `src/pages/login.ts`
- Create: `src/pages/signup.ts`
- Modify: `src/server/index.ts`

**Step 1: Create the landing page**

Create `src/pages/landing.ts`:

```typescript
export function renderLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slapture</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 2rem; text-align: center; }
    h1 { font-size: 2.5rem; margin-top: 4rem; }
    .tagline { color: #666; margin: 1rem 0 2rem; font-size: 1.1rem; }
    .cta { display: inline-block; padding: 0.75rem 2rem; background: #333; color: white; text-decoration: none; border-radius: 6px; font-size: 1rem; }
    .cta:hover { background: #555; }
  </style>
</head>
<body>
  <div class="container">
    <h1>slapture</h1>
    <p class="tagline">Capture anything. Route it intelligently.</p>
    <a href="/login" class="cta">Sign in</a>
  </div>
</body>
</html>`;
}
```

**Step 2: Create the login page**

Create `src/pages/login.ts`:

```typescript
export function renderLoginPage(firebaseConfig: Record<string, string>): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in — Slapture</title>
  <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/ui/7.0.0/firebase-ui-auth.js"></script>
  <link type="text/css" rel="stylesheet" href="https://www.gstatic.com/firebasejs/ui/7.0.0/firebase-ui-auth.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #333; }
    .container { max-width: 400px; margin: 0 auto; padding: 2rem; }
    h1 { text-align: center; margin: 2rem 0; }
    .note { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.85rem; color: #856404; }
    .back { display: block; text-align: center; margin-top: 1.5rem; color: #666; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sign in to Slapture</h1>
    <div class="note">
      Google sign-in is currently in test mode. If you get an error, your Google account may need to be added to the approved list.
    </div>
    <div id="firebaseui-auth-container"></div>
    <a href="/" class="back">← Back</a>
  </div>
  <script>
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    firebase.initializeApp(firebaseConfig);

    const ui = new firebaseui.auth.AuthUI(firebase.auth());
    ui.start('#firebaseui-auth-container', {
      signInSuccessUrl: '/widget',
      signInOptions: [
        firebase.auth.GoogleAuthProvider.PROVIDER_ID,
        firebase.auth.EmailAuthProvider.PROVIDER_ID,
      ],
      tosUrl: '/',
      privacyPolicyUrl: '/',
    });
  </script>
</body>
</html>`;
}
```

**Step 3: Create the signup page**

Create `src/pages/signup.ts`:

```typescript
import { renderLoginPage } from './login.js';

// Signup is the same UI as login (Firebase handles both).
// It's just at a different, non-linked URL.
export function renderSignupPage(firebaseConfig: Record<string, string>): string {
  return renderLoginPage(firebaseConfig);
}
```

**Step 4: Wire pages into server**

Add to `src/server/index.ts`, before the auth middleware:

```typescript
  // Firebase client config (for login/signup pages)
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  };
```

Add routes (after middleware, before /capture):

```typescript
  // Public pages
  if (useFirebaseAuth) {
    const { renderLandingPage } = await import('../pages/landing.js');
    const { renderLoginPage } = await import('../pages/login.js');
    const { renderSignupPage } = await import('../pages/signup.js');

    app.get('/', (c) => c.html(renderLandingPage()));
    app.get('/login', (c) => c.html(renderLoginPage(firebaseConfig)));
    app.get('/signup', (c) => c.html(renderSignupPage(firebaseConfig)));
  }
```

**Step 5: Build and test**

Run: `pnpm build`
Run: `pnpm vitest run`
Expected: All pass

**Step 6: Commit**

```bash
git add src/pages/landing.ts src/pages/login.ts src/pages/signup.ts src/server/index.ts
git commit -m "feat: add landing, login, and signup pages with FirebaseUI"
```

---

### Task 9: Update widget to use Firebase Auth

**Files:**
- Modify: `src/widget/index.html`

**Step 1: Update the widget**

The widget currently doesn't do auth (it's in the public path list). When `useFirebaseAuth` is true, the widget needs to:
1. Check if user is signed in via Firebase Auth
2. If not, redirect to `/login`
3. If yes, include the ID token in API requests

Add Firebase SDK scripts to the widget's `<head>` and modify the capture submission to include the Bearer token. The exact changes depend on the current widget structure — the key additions are:

- Firebase JS SDK initialization
- `firebase.auth().onAuthStateChanged()` to check login state
- `firebase.auth().currentUser.getIdToken()` before each API call
- Redirect to `/login` if not authenticated

This task is intentionally less prescriptive since the widget HTML may need creative adaptation. The key requirement: authenticated API calls using Firebase ID tokens.

**Step 2: Test manually**

Deploy locally with Firestore backend and test:
1. Visit `/widget` → should redirect to `/login` if not signed in
2. Sign in → should redirect back to widget
3. Submit a capture → should work with Firebase token

**Step 3: Commit**

```bash
git add src/widget/index.html
git commit -m "feat: add Firebase Auth to capture widget"
```

---

### Task 10: Update dashboard to remove ?token= dependency

**Files:**
- Modify: `src/dashboard/routes.ts`
- Modify: `src/dashboard/templates.ts`

**Step 1: Update dashboard routes**

The dashboard currently passes `?token=` through all links and forms. With Firebase Auth, this is no longer needed (the middleware handles auth via headers/cookies). However, the dashboard is server-rendered HTML, so browser requests won't have an Authorization header by default.

**Approach:** When `useFirebaseAuth` is true, the dashboard pages should include a small script that:
1. Gets the Firebase ID token
2. Stores it in a cookie or passes it via a custom header on navigation

**Alternative (simpler for now):** Since the dashboard is server-rendered, add a session cookie approach specifically for dashboard browsing:
- After Firebase Auth login, client calls `POST /api/session` with the ID token
- Server sets an `__session` cookie (Firebase Hosting compatible)
- Dashboard middleware reads the cookie

This is a pragmatic addition — for server-rendered HTML pages, cookies are the only way to authenticate navigation requests.

Add a cookie-reading fallback to the auth middleware in `src/server/auth.ts`:

```typescript
    // Try session cookie (for dashboard browsing)
    const sessionCookie = getCookie(c, '__session');
    if (sessionCookie) {
      try {
        const decoded = await getAuth().verifyIdToken(sessionCookie);
        const authCtx: AuthContext = {
          uid: decoded.uid,
          email: decoded.email || '',
          authMethod: 'firebase',
        };
        c.set('auth', authCtx);
        return next();
      } catch {
        // Cookie invalid/expired, fall through
      }
    }
```

Add a session endpoint:

```typescript
  app.post('/api/session', async (c) => {
    const { idToken } = await c.req.json();
    // Set as cookie — short-lived, the client should refresh it
    c.header('Set-Cookie', `__session=${idToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`);
    return c.json({ ok: true });
  });
```

Update dashboard templates to remove `?token=` from all links (just remove the token query param from all URLs).

Update the dashboard `layout` function to get auth context from the request rather than query param.

Pass `auth` context to `buildDashboardRoutes` so it can use `auth.uid` for user-scoped queries.

**Step 2: Run tests**

Run: `pnpm vitest run`
Expected: All pass (existing dashboard tests use local mode with ?token=)

**Step 3: Commit**

```bash
git add src/server/auth.ts src/server/index.ts src/dashboard/routes.ts src/dashboard/templates.ts
git commit -m "feat: update dashboard for Firebase Auth, add session cookie support"
```

---

### Task 11: User auto-creation on first sign-in

**Files:**
- Modify: `src/server/auth.ts`

**Step 1: Write the test**

Add to `tests/server/auth-middleware.test.ts`:

```typescript
  it('should create user profile on first Firebase auth', async () => {
    // This tests the auto-creation behavior when verifyIdToken succeeds
    // but getUser returns null (first login)
    // Implementation: after successful Firebase token verification,
    // check if user exists, if not create them
  });
```

**Step 2: Add user auto-creation to Firebase auth path**

In `src/server/auth.ts`, after `verifyIdToken` succeeds:

```typescript
      try {
        const decoded = await getAuth().verifyIdToken(idToken);
        const authCtx: AuthContext = {
          uid: decoded.uid,
          email: decoded.email || '',
          authMethod: 'firebase',
        };

        // Auto-create user on first sign-in
        const existingUser = await storage.getUser(decoded.uid);
        if (!existingUser) {
          await storage.saveUser({
            uid: decoded.uid,
            email: decoded.email || '',
            displayName: decoded.name || decoded.email?.split('@')[0] || 'User',
            createdAt: new Date().toISOString(),
            authProvider: decoded.firebase?.sign_in_provider === 'google.com' ? 'google' : 'email',
          });
        }

        c.set('auth', authCtx);
        return next();
      }
```

**Step 3: Test and commit**

Run: `pnpm vitest run`
Run: `pnpm build`

```bash
git add src/server/auth.ts tests/server/auth-middleware.test.ts
git commit -m "feat: auto-create user profile on first Firebase sign-in"
```

---

### Task 12: E2E test with Firebase Auth Emulator

**Files:**
- Create: `tests/e2e/auth.spec.ts`
- Modify: `playwright.config.ts` (if needed, for Firebase emulator setup)

**Step 1: Set up Firebase emulator config**

Create `firebase.json` (if not exists):
```json
{
  "emulators": {
    "auth": {
      "port": 9099
    },
    "firestore": {
      "port": 8081
    }
  }
}
```

**Step 2: Write E2E test**

Create `tests/e2e/auth.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('landing page loads without auth', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('slapture');
    await expect(page.locator('a[href="/login"]')).toBeVisible();
  });

  test('login page loads with FirebaseUI', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#firebaseui-auth-container')).toBeVisible();
  });

  test('protected routes redirect/return 401 without auth', async ({ request }) => {
    const res = await request.get('/captures');
    expect(res.status()).toBe(401);
  });

  test('API key auth works for capture endpoint', async ({ request }) => {
    // This test requires a pre-created API key
    // In CI, use Firebase emulator + programmatic user creation
    test.skip(true, 'Requires Firebase emulator setup');
  });
});
```

**Step 3: Run E2E tests**

Run: `pnpm test:e2e`
Expected: Landing page and login page tests pass. Auth-required tests verify 401s.

**Step 4: Commit**

```bash
git add tests/e2e/auth.spec.ts firebase.json
git commit -m "test: add E2E auth tests and Firebase emulator config"
```

---

### Task 13: Update existing tests for new auth parameter

**Files:**
- Modify: `tests/unit/server.test.ts`
- Modify: any other tests that call `buildServer`

**Step 1: Update server test imports and setup**

The `buildServer` function now has a 5th parameter `useFirebaseAuth`. Existing tests don't pass it, defaulting to `false`, so they should continue working. Verify this.

Run: `pnpm vitest run`

If any tests break due to the signature change, update them to explicitly pass `false`:

```typescript
app = await buildServer(storage, TEST_FILESTORE, 'test-api-key', undefined, false);
```

**Step 2: Commit if changes needed**

```bash
git add tests/
git commit -m "test: update existing tests for new buildServer signature"
```

---

### Task 14: Environment variable documentation and Dockerfile update

**Files:**
- Modify: `Dockerfile`
- Create or update: `.env.example`

**Step 1: Update Dockerfile**

No changes needed to the Dockerfile itself (Firebase Admin SDK uses ambient GCP credentials on Cloud Run). But document the new env vars.

**Step 2: Create .env.example**

```bash
# Required
ANTHROPIC_API_KEY=
STORAGE_BACKEND=firestore  # or 'local'

# Firebase (required when STORAGE_BACKEND=firestore)
FIREBASE_PROJECT_ID=
FIREBASE_WEB_API_KEY=        # Client-side Firebase config
FIREBASE_AUTH_DOMAIN=        # e.g. your-project.firebaseapp.com

# Google Sheets integration (optional)
GOOGLE_SHEETS_CLIENT_ID=
GOOGLE_SHEETS_CLIENT_SECRET=

# Intend.do integration (optional)
INTEND_CLIENT_ID=
INTEND_CLIENT_SECRET=

# Server
PORT=4444
CALLBACK_BASE_URL=http://localhost:4444
```

**Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add .env.example with Firebase auth config"
```

---

### Task 15: Final integration test and cleanup

**Step 1: Run all tests**

Run: `pnpm vitest run`
Run: `pnpm test:e2e`
Run: `pnpm build`

**Step 2: Verify no regressions**

All existing functionality should work in local mode (`STORAGE_BACKEND=local`, `useFirebaseAuth=false`).

**Step 3: Test cloud mode locally (optional)**

If Firebase emulator is available:

```bash
STORAGE_BACKEND=firestore FIREBASE_PROJECT_ID=demo-slapture FIRESTORE_EMULATOR_HOST=localhost:8081 pnpm dev
```

Visit `http://localhost:4444/` — should see landing page.

**Step 4: Final commit if any cleanup needed**

```bash
git commit -m "chore: final auth integration cleanup"
```
