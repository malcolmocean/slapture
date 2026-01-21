// tests/unit/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../../src/storage/index.js';
import { Capture, Route } from '../../src/types.js';
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
});
