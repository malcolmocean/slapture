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
