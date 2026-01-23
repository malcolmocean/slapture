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

      await storage.saveIntendTokens(tokens);
      const retrieved = await storage.getIntendTokens();

      expect(retrieved).toEqual(tokens);
    });

    it('should return null when no intend tokens exist', async () => {
      const tokens = await storage.getIntendTokens();
      expect(tokens).toBeNull();
    });

    it('should clear intend tokens', async () => {
      const tokens: IntendTokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: '2026-01-22T12:00:00Z',
        baseUrl: 'https://intend.do'
      };

      await storage.saveIntendTokens(tokens);
      await storage.clearIntendTokens();
      const retrieved = await storage.getIntendTokens();

      expect(retrieved).toBeNull();
    });

    it('should list captures needing auth', async () => {
      // Create a blocked capture
      const capture: Capture = {
        id: 'test-capture-1',
        raw: 'intend: test intention',
        timestamp: new Date().toISOString(),
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
});
