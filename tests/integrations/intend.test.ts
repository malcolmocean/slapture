// tests/integrations/intend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntendClient } from '../../src/integrations/intend';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IntendClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('addIntention', () => {
    it('should POST intention to intend.do API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'intention-123', text: 'buy groceries' })
      });

      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-12-31T23:59:59Z',
        baseUrl: 'https://intend.do'
      });

      const result = await client.addIntention('buy groceries');

      // API format: POST /api/v0/u/me/intentions with { raw: "X) text" }
      // where X is goal (1-9) or & for ungrouped
      expect(mockFetch).toHaveBeenCalledWith(
        'https://intend.do/api/v0/u/me/intentions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({ raw: '&) buy groceries' })
        })
      );
      expect(result.success).toBe(true);
    });

    it('should return auth_expired when 401 received', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const client = new IntendClient({
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        expiresAt: '2020-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.authExpired).toBe(true);
    });

    it('should return error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-12-31T23:59:59Z',
        baseUrl: 'https://intend.do'
      });

      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for expired token', () => {
      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2020-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      expect(client.isTokenExpired()).toBe(true);
    });

    it('should return false for valid token', () => {
      const client = new IntendClient({
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      expect(client.isTokenExpired()).toBe(false);
    });
  });
});
