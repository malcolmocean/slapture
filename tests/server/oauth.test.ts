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
    it('should redirect to intend.do OAuth authorize URL', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/connect/intend'
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('https://intend.do/oauth/authorize');
      expect(response.headers.location).toContain('client_id=test-client-id');
      expect(response.headers.location).toContain('redirect_uri=');
    });
  });

  describe('GET /oauth/callback/intend', () => {
    it('should exchange code for tokens and store them', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        })
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend?code=auth-code-123'
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('/oauth/success');

      // Verify tokens were stored
      const tokens = await storage.getIntendTokens();
      expect(tokens?.accessToken).toBe('new-access-token');
      expect(tokens?.refreshToken).toBe('new-refresh-token');
    });

    it('should handle token exchange failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend?code=bad-code'
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('/oauth/error');
    });

    it('should handle missing code parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/callback/intend'
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /auth/status/intend', () => {
    it('should return connected false when no tokens', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend'
      });

      const body = JSON.parse(response.body);
      expect(body.connected).toBe(false);
    });

    it('should return connected true when tokens exist', async () => {
      await storage.saveIntendTokens({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/status/intend'
      });

      const body = JSON.parse(response.body);
      expect(body.connected).toBe(true);
    });
  });

  describe('POST /disconnect/intend', () => {
    it('should clear tokens', async () => {
      await storage.saveIntendTokens({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const response = await app.inject({
        method: 'POST',
        url: '/disconnect/intend'
      });

      expect(response.statusCode).toBe(200);

      const tokens = await storage.getIntendTokens();
      expect(tokens).toBeNull();
    });
  });
});
