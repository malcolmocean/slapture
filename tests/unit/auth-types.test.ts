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
