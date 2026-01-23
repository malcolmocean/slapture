// tests/unit/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../../src/storage/index.js';
import { Capture, Route, IntendTokens } from '../../src/types.js';
import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = './test-data';

describe('Storage', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(TEST_DATA_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('captures', () => {
    it('should save and retrieve a capture', async () => {
      const capture: Capture = {
        id: 'test-123',
        raw: 'dump: hello',
        timestamp: '2026-01-21T12:00:00Z',
        username: 'default',
        parsed: null,
        routeProposed: null,
        routeConfidence: null,
        routeFinal: null,
        executionTrace: [],
        executionResult: 'pending',
        verificationState: 'pending',
        retiredFromTests: false,
        retiredReason: null,
      };

      await storage.saveCapture(capture);
      const retrieved = await storage.getCapture('test-123');

      expect(retrieved).toEqual(capture);
    });

    it('should return null for non-existent capture', async () => {
      const retrieved = await storage.getCapture('does-not-exist');
      expect(retrieved).toBeNull();
    });

    it('should list recent captures', async () => {
      const capture1: Capture = {
        id: 'cap-1',
        raw: 'first',
        timestamp: '2026-01-21T12:00:00Z',
        username: 'default',
        parsed: null,
        routeProposed: null,
        routeConfidence: null,
        routeFinal: null,
        executionTrace: [],
        executionResult: 'pending',
        verificationState: 'pending',
        retiredFromTests: false,
        retiredReason: null,
      };
      const capture2: Capture = {
        ...capture1,
        id: 'cap-2',
        raw: 'second',
        timestamp: '2026-01-21T12:01:00Z',
      };

      await storage.saveCapture(capture1);
      await storage.saveCapture(capture2);

      const captures = await storage.listCaptures(10);
      expect(captures).toHaveLength(2);
    });
  });

  describe('routes', () => {
    it('should save and retrieve a route', async () => {
      const route: Route = {
        id: 'route-1',
        name: 'dump',
        description: 'Dump text to file',
        triggers: [{ type: 'prefix', pattern: 'dump:', priority: 10 }],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'dump.txt' },
        transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await storage.saveRoute(route);
      const retrieved = await storage.getRoute('route-1');

      expect(retrieved).toEqual(route);
    });

    it('should find route by name', async () => {
      const route: Route = {
        id: 'route-2',
        name: 'notes',
        description: 'Save notes',
        triggers: [{ type: 'prefix', pattern: 'note:', priority: 10 }],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'notes.json' },
        transformScript: null,
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await storage.saveRoute(route);
      const found = await storage.getRouteByName('notes');

      expect(found?.id).toBe('route-2');
    });
  });

  describe('Capture username field', () => {
    it('should store and retrieve capture with username', async () => {
      const capture: Capture = {
        id: 'test-id',
        raw: 'test',
        timestamp: new Date().toISOString(),
        username: 'malcolm',  // New field
        parsed: null,
        routeProposed: null,
        routeConfidence: null,
        routeFinal: null,
        executionTrace: [],
        executionResult: 'pending',
        verificationState: 'pending',
        retiredFromTests: false,
        retiredReason: null,
      };

      await storage.saveCapture(capture, 'malcolm');
      const retrieved = await storage.getCapture('test-id');
      expect(retrieved?.username).toBe('malcolm');
    });
  });

  describe('Integration Storage', () => {
    it('should save and retrieve intend tokens', async () => {
      const tokens: IntendTokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: '2026-01-22T12:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await storage.saveIntendTokens('default', tokens);
      const retrieved = await storage.getIntendTokens('default');

      expect(retrieved).toEqual(tokens);
    });

    it('should return null when no intend tokens exist', async () => {
      const tokens = await storage.getIntendTokens('default');
      expect(tokens).toBeNull();
    });

    it('should clear intend tokens', async () => {
      const tokens: IntendTokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: '2026-01-22T12:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await storage.saveIntendTokens('default', tokens);
      await storage.clearIntendTokens('default');
      const retrieved = await storage.getIntendTokens('default');

      expect(retrieved).toBeNull();
    });

    it('should list captures needing auth', async () => {
      // Create a blocked capture
      const capture: Capture = {
        id: 'test-capture-1',
        raw: 'intend: test intention',
        timestamp: new Date().toISOString(),
        username: 'default',
        parsed: { explicitRoute: 'intend', payload: 'test intention', metadata: {} },
        routeProposed: 'intend-route',
        routeConfidence: 'high' as const,
        routeFinal: 'intend-route',
        executionTrace: [],
        executionResult: 'blocked_needs_auth' as const,
        verificationState: 'pending' as const,
        retiredFromTests: false,
        retiredReason: null
      };

      await storage.saveCapture(capture, 'default');
      const blocked = await storage.listCapturesNeedingAuth();

      expect(blocked.length).toBe(1);
      expect(blocked[0].id).toBe('test-capture-1');
    });

    it('should list captures with expired auth', async () => {
      const capture: Capture = {
        id: 'test-capture-2',
        raw: 'intend: another intention',
        timestamp: new Date().toISOString(),
        username: 'default',
        parsed: { explicitRoute: 'intend', payload: 'another intention', metadata: {} },
        routeProposed: 'intend-route',
        routeConfidence: 'high' as const,
        routeFinal: 'intend-route',
        executionTrace: [],
        executionResult: 'blocked_auth_expired' as const,
        verificationState: 'pending' as const,
        retiredFromTests: false,
        retiredReason: null
      };

      await storage.saveCapture(capture, 'default');
      const blocked = await storage.listCapturesNeedingAuth();

      expect(blocked.length).toBe(1);
      expect(blocked[0].id).toBe('test-capture-2');
    });

    it('should not include non-blocked captures in listCapturesNeedingAuth', async () => {
      const successCapture: Capture = {
        id: 'success-capture',
        raw: 'dump: hello',
        timestamp: new Date().toISOString(),
        username: 'default',
        parsed: null,
        routeProposed: null,
        routeConfidence: null,
        routeFinal: null,
        executionTrace: [],
        executionResult: 'success' as const,
        verificationState: 'pending' as const,
        retiredFromTests: false,
        retiredReason: null
      };

      await storage.saveCapture(successCapture, 'default');
      const blocked = await storage.listCapturesNeedingAuth();

      expect(blocked.length).toBe(0);
    });
  });

  describe('Username validation', () => {
    it('should reject usernames with forward slash', async () => {
      const tokens: IntendTokens = {
        accessToken: 'test',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await expect(storage.saveIntendTokens('../evil', tokens)).rejects.toThrow('Invalid username');
    });

    it('should reject usernames with backslash', async () => {
      const tokens: IntendTokens = {
        accessToken: 'test',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await expect(storage.saveIntendTokens('..\\evil', tokens)).rejects.toThrow('Invalid username');
    });

    it('should reject username that is just ".."', async () => {
      const tokens: IntendTokens = {
        accessToken: 'test',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await expect(storage.saveIntendTokens('..', tokens)).rejects.toThrow('Invalid username');
    });

    it('should reject username that is just "."', async () => {
      const tokens: IntendTokens = {
        accessToken: 'test',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await expect(storage.saveIntendTokens('.', tokens)).rejects.toThrow('Invalid username');
    });

    it('should reject empty username', async () => {
      const tokens: IntendTokens = {
        accessToken: 'test',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await expect(storage.saveIntendTokens('', tokens)).rejects.toThrow('Invalid username');
    });

    it('should reject path traversal in capture username', async () => {
      const capture: Capture = {
        id: 'test-id',
        raw: 'test',
        timestamp: new Date().toISOString(),
        username: '../evil',
        parsed: null,
        routeProposed: null,
        routeConfidence: null,
        routeFinal: null,
        executionTrace: [],
        executionResult: 'pending',
        verificationState: 'pending',
        retiredFromTests: false,
        retiredReason: null,
      };

      await expect(storage.saveCapture(capture, '../evil')).rejects.toThrow('Invalid username');
    });

    it('should accept valid usernames', async () => {
      const tokens: IntendTokens = {
        accessToken: 'test',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      // These should not throw
      await storage.saveIntendTokens('validuser', tokens);
      await storage.saveIntendTokens('user-with-dashes', tokens);
      await storage.saveIntendTokens('user_with_underscores', tokens);
      await storage.saveIntendTokens('user123', tokens);

      expect(await storage.getIntendTokens('validuser')).not.toBeNull();
    });
  });

  describe('Per-user token storage', () => {
    it('should save and retrieve tokens for specific user', async () => {
      const tokens: IntendTokens = {
        accessToken: 'token-for-malcolm',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await storage.saveIntendTokens('malcolm', tokens);
      const retrieved = await storage.getIntendTokens('malcolm');
      expect(retrieved?.accessToken).toBe('token-for-malcolm');

      // Different user should have no tokens
      const otherUser = await storage.getIntendTokens('default');
      expect(otherUser).toBeNull();
    });

    it('should store tokens in users directory', async () => {
      const tokens: IntendTokens = {
        accessToken: 'test',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await storage.saveIntendTokens('testuser', tokens);

      const userConfigPath = path.join(TEST_DATA_DIR, 'users', 'testuser', 'config.json');
      expect(fs.existsSync(userConfigPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
      expect(config.integrations.intend.accessToken).toBe('test');
    });

    it('should clear tokens for specific user only', async () => {
      await storage.saveIntendTokens('user1', {
        accessToken: 'token1',
        refreshToken: 'r1',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });
      await storage.saveIntendTokens('user2', {
        accessToken: 'token2',
        refreshToken: 'r2',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      await storage.clearIntendTokens('user1');

      expect(await storage.getIntendTokens('user1')).toBeNull();
      expect((await storage.getIntendTokens('user2'))?.accessToken).toBe('token2');
    });
  });
});
