// tests/server/oauth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'fs';
import { Storage } from '../../src/storage';
import { buildOAuthRoutes } from '../../src/server/oauth';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OAuth Endpoints', () => {
  let app: Hono;
  let storage: Storage;
  const testDir = './test-data-oauth';

  beforeEach(async () => {
    mockFetch.mockReset();
    fs.mkdirSync(testDir, { recursive: true });
    storage = new Storage(testDir);

    app = new Hono();
    buildOAuthRoutes(app, storage, {
      intendClientId: 'test-client-id',
      intendClientSecret: 'test-client-secret',
      intendBaseUrl: 'https://intend.do',
      callbackBaseUrl: 'http://localhost:4444'
    });
  });

  afterEach(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('GET /connect/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.request('/connect/intend');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });

    it('should redirect with user in state parameter', async () => {
      const response = await app.request('/connect/intend?user=malcolm', { redirect: 'manual' });
      expect(response.status).toBe(302);
      const location = response.headers.get('location')!;
      expect(location).toContain('https://intend.do/oauth/authorize');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('state=');

      const url = new URL(location);
      const state = url.searchParams.get('state');
      expect(state).toBeTruthy();
      const decoded = JSON.parse(Buffer.from(state!, 'base64').toString());
      expect(decoded.user).toBe('malcolm');
      expect(decoded.csrf).toBeTruthy();
    });
  });

  describe('GET /oauth/callback/intend', () => {
    it('should handle missing code parameter', async () => {
      const response = await app.request('/oauth/callback/intend');
      expect(response.status).toBe(400);
    });

    it('should require state parameter', async () => {
      const response = await app.request('/oauth/callback/intend?code=auth-code-123');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('state');
    });

    it('should extract user from state and save tokens for that user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        })
      });

      const state = Buffer.from(JSON.stringify({ user: 'malcolm', csrf: 'test-csrf' })).toString('base64');
      const response = await app.request(`/oauth/callback/intend?code=auth-code-123&state=${state}`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/oauth/success');

      const tokens = await storage.getIntendTokens('malcolm');
      expect(tokens?.accessToken).toBe('new-access-token');
      expect(tokens?.refreshToken).toBe('new-refresh-token');

      const defaultTokens = await storage.getIntendTokens('default');
      expect(defaultTokens).toBeNull();
    });

    it('should handle token exchange failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Bad Request'
      });

      const state = Buffer.from(JSON.stringify({ user: 'malcolm', csrf: 'test-csrf' })).toString('base64');
      const response = await app.request(`/oauth/callback/intend?code=bad-code&state=${state}`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/oauth/error');
    });

    it('should handle invalid state parameter (malformed JSON)', async () => {
      const response = await app.request('/oauth/callback/intend?code=auth-code-123&state=invalid-base64');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('state');
    });

    it('should handle state missing user field', async () => {
      const state = Buffer.from(JSON.stringify({ csrf: 'test-csrf' })).toString('base64');
      const response = await app.request(`/oauth/callback/intend?code=auth-code-123&state=${state}`);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });
  });

  describe('GET /auth/status/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.request('/auth/status/intend');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });

    it('should return connected false when no tokens for user', async () => {
      const response = await app.request('/auth/status/intend?user=malcolm');
      const body = await response.json();
      expect(body.connected).toBe(false);
    });

    it('should return connected true when tokens exist for user', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/auth/status/intend?user=malcolm');
      const body = await response.json();
      expect(body.connected).toBe(true);
      expect(body.expired).toBe(false);
    });

    it('should return status for specific user only', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const malcolmResponse = await app.request('/auth/status/intend?user=malcolm');
      expect((await malcolmResponse.json()).connected).toBe(true);

      const defaultResponse = await app.request('/auth/status/intend?user=default');
      expect((await defaultResponse.json()).connected).toBe(false);
    });

    it('should indicate expired tokens', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2020-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/auth/status/intend?user=malcolm');
      const body = await response.json();
      expect(body.connected).toBe(true);
      expect(body.expired).toBe(true);
    });
  });

  describe('POST /disconnect/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.request('/disconnect/intend', { method: 'POST' });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('user');
    });

    it('should clear tokens for specific user', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/disconnect/intend?user=malcolm', { method: 'POST' });
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);

      const tokens = await storage.getIntendTokens('malcolm');
      expect(tokens).toBeNull();
    });

    it('should clear tokens for specific user only', async () => {
      await storage.saveIntendTokens('user1', {
        accessToken: 'token1',
        refreshToken: 'refresh1',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });
      await storage.saveIntendTokens('user2', {
        accessToken: 'token2',
        refreshToken: 'refresh2',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.request('/disconnect/intend?user=user1', { method: 'POST' });
      expect(response.status).toBe(200);

      const user1Tokens = await storage.getIntendTokens('user1');
      expect(user1Tokens).toBeNull();

      const user2Tokens = await storage.getIntendTokens('user2');
      expect(user2Tokens?.accessToken).toBe('token2');
    });
  });
});
