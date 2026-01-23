// tests/server/oauth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import * as fs from 'fs';
import { Storage } from '../../src/storage';
import { buildOAuthRoutes } from '../../src/server/oauth';

// Mock fetch for token exchange
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OAuth Endpoints', () => {
  let app: ReturnType<typeof Fastify>;
  let storage: Storage;
  const testDir = './test-data-oauth';

  beforeEach(async () => {
    mockFetch.mockReset();
    fs.mkdirSync(testDir, { recursive: true });
    storage = new Storage(testDir);

    app = Fastify();
    buildOAuthRoutes(app, storage, {
      intendClientId: 'test-client-id',
      intendClientSecret: 'test-client-secret',
      intendBaseUrl: 'https://intend.do',
      callbackBaseUrl: 'http://localhost:3333'
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('GET /connect/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/connect/intend'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('user');
    });

    it('should redirect with user in state parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/connect/intend?user=malcolm'
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers.location as string;
      expect(location).toContain('https://intend.do/oauth/authorize');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('state=');

      // Decode state to verify user is encoded
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
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend'
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require state parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend?code=auth-code-123'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('state');
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

      // Create state with user encoded
      const state = Buffer.from(JSON.stringify({ user: 'malcolm', csrf: 'test-csrf' })).toString('base64');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/callback/intend?code=auth-code-123&state=${state}`
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('/oauth/success');

      // Verify tokens were stored for 'malcolm'
      const tokens = await storage.getIntendTokens('malcolm');
      expect(tokens?.accessToken).toBe('new-access-token');
      expect(tokens?.refreshToken).toBe('new-refresh-token');

      // Verify 'default' user has no tokens
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

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/callback/intend?code=bad-code&state=${state}`
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('/oauth/error');
    });

    it('should handle invalid state parameter (malformed JSON)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend?code=auth-code-123&state=invalid-base64'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('state');
    });

    it('should handle state missing user field', async () => {
      const state = Buffer.from(JSON.stringify({ csrf: 'test-csrf' })).toString('base64');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/callback/intend?code=auth-code-123&state=${state}`
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('user');
    });
  });

  describe('GET /auth/status/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('user');
    });

    it('should return connected false when no tokens for user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend?user=malcolm'
      });

      const body = JSON.parse(response.body);
      expect(body.connected).toBe(false);
    });

    it('should return connected true when tokens exist for user', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend?user=malcolm'
      });

      const body = JSON.parse(response.body);
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

      // Check malcolm - should be connected
      const malcolmResponse = await app.inject({
        method: 'GET',
        url: '/auth/status/intend?user=malcolm'
      });
      expect(malcolmResponse.json().connected).toBe(true);

      // Check default - should not be connected
      const defaultResponse = await app.inject({
        method: 'GET',
        url: '/auth/status/intend?user=default'
      });
      expect(defaultResponse.json().connected).toBe(false);
    });

    it('should indicate expired tokens', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2020-01-01T00:00:00Z', // Past date
        baseUrl: 'https://intend.do'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend?user=malcolm'
      });

      const body = JSON.parse(response.body);
      expect(body.connected).toBe(true);
      expect(body.expired).toBe(true);
    });
  });

  describe('POST /disconnect/intend', () => {
    it('should require user parameter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/disconnect/intend'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('user');
    });

    it('should clear tokens for specific user', async () => {
      await storage.saveIntendTokens('malcolm', {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.inject({
        method: 'POST',
        url: '/disconnect/intend?user=malcolm'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      const tokens = await storage.getIntendTokens('malcolm');
      expect(tokens).toBeNull();
    });

    it('should clear tokens for specific user only', async () => {
      // Save tokens for user1 and user2
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

      // Disconnect user1
      const response = await app.inject({
        method: 'POST',
        url: '/disconnect/intend?user=user1'
      });

      expect(response.statusCode).toBe(200);

      // Verify user1 has no tokens
      const user1Tokens = await storage.getIntendTokens('user1');
      expect(user1Tokens).toBeNull();

      // Verify user2 still has tokens
      const user2Tokens = await storage.getIntendTokens('user2');
      expect(user2Tokens?.accessToken).toBe('token2');
    });
  });
});
