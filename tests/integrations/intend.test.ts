// tests/integrations/intend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntendClient } from '../../src/integrations/intend';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IntendClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const makeClient = (overrides: Partial<{ accessToken: string; expiresAt: string; baseUrl: string }> = {}) =>
    new IntendClient({
      accessToken: overrides.accessToken ?? 'test-token',
      refreshToken: 'refresh-token',
      expiresAt: overrides.expiresAt ?? '2030-12-31T23:59:59Z',
      baseUrl: overrides.baseUrl ?? 'https://intend.do',
    });

  const mockOk = (data: unknown = { count: 1 }) =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => data,
    });

  describe('addIntention', () => {
    it('should POST with default ungrouped goal (&)', async () => {
      mockOk();
      const client = makeClient();
      const result = await client.addIntention('buy groceries');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://intend.do/api/v0/u/me/intentions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ raw: '&) buy groceries' }),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('should format single goal number correctly', async () => {
      mockOk();
      const client = makeClient();
      await client.addIntention('practice guitar for 30 minutes', '1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ raw: '1) practice guitar for 30 minutes' }),
        }),
      );
    });

    it('should format multi-goal codes (e.g. "2,3")', async () => {
      mockOk();
      const client = makeClient();
      await client.addIntention('go for a walk with John', '2,3');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ raw: '2,3) go for a walk with John' }),
        }),
      );
    });

    it('should format inactive goal codes (two letters)', async () => {
      mockOk();
      const client = makeClient();
      await client.addIntention('upgrade node', 'AB');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ raw: 'AB) upgrade node' }),
        }),
      );
    });

    it('should return response data on success', async () => {
      const responseData = { count: 3, today: { core: ['item1', 'item2', 'item3'] } };
      mockOk(responseData);
      const client = makeClient();
      const result = await client.addIntention('test');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(responseData);
    });

    it('should return auth_expired on 401', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
      const client = makeClient();
      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.authExpired).toBe(true);
    });

    it('should return error with status on 400 (invalid intention)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request' });
      const client = makeClient();
      const result = await client.addIntention('');

      expect(result.success).toBe(false);
      expect(result.error).toContain('400');
    });

    it('should return error on 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });
      const client = makeClient();
      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should return error on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' });
      const client = makeClient();
      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('429');
    });

    it('should handle network errors (fetch throws)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = makeClient();
      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should handle DNS resolution failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND intend.do'));
      const client = makeClient();
      const result = await client.addIntention('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should use custom baseUrl', async () => {
      mockOk();
      const client = makeClient({ baseUrl: 'https://staging.intend.do' });
      await client.addIntention('test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://staging.intend.do/api/v0/u/me/intentions',
        expect.any(Object),
      );
    });
  });

  describe('isTokenExpired', () => {
    it('should return true for past date', () => {
      const client = makeClient({ expiresAt: '2020-01-01T00:00:00Z' });
      expect(client.isTokenExpired()).toBe(true);
    });

    it('should return false for future date', () => {
      const client = makeClient({ expiresAt: '2030-01-01T00:00:00Z' });
      expect(client.isTokenExpired()).toBe(false);
    });

    it('should return true when within 5-minute buffer window', () => {
      // Token expires 3 minutes from now — within the 5-min buffer, so "expired"
      const threeMinutesFromNow = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      const client = makeClient({ expiresAt: threeMinutesFromNow });
      expect(client.isTokenExpired()).toBe(true);
    });

    it('should return false when outside 5-minute buffer window', () => {
      // Token expires 10 minutes from now — outside the 5-min buffer
      const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const client = makeClient({ expiresAt: tenMinutesFromNow });
      expect(client.isTokenExpired()).toBe(false);
    });
  });
});
