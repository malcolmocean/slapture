// tests/unit/hygiene.test.ts
//
// Tests for route hygiene signal handling.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RouteHygiene, HygieneSignal } from '../../src/hygiene/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route, createTrigger, getTriggerStats } from '../../src/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('RouteHygiene', () => {
  let tempDir: string;
  let storage: Storage;
  let hygiene: RouteHygiene;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slapture-hygiene-test-'));
    storage = new Storage(tempDir);
    hygiene = new RouteHygiene(storage);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('recordSignal', () => {
    it('should record a hygiene signal with auto-generated id and timestamp', async () => {
      const signal = await hygiene.recordSignal({
        routeId: 'route-1',
        routeName: 'test_route',
        triggerPattern: '^test',
        signalType: 'validation_reject',
        captureId: 'capture-1',
        input: 'test input',
        details: 'Not the right intent',
      });

      expect(signal.id).toMatch(/^hygiene-/);
      expect(signal.timestamp).toBeTruthy();
      expect(signal.routeId).toBe('route-1');
      expect(signal.signalType).toBe('validation_reject');

      // Verify it was persisted
      const signals = await storage.getHygieneSignals();
      expect(signals).toHaveLength(1);
      expect(signals[0].id).toBe(signal.id);
    });
  });

  describe('recordValidationSignal', () => {
    it('should record doubtful validation signal', async () => {
      const route: Route = {
        id: 'route-test',
        name: 'test_route',
        description: 'Test',
        triggers: [createTrigger('^test')],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'test.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };
      const trigger = createTrigger('^test');

      const signal = await hygiene.recordValidationSignal(
        route,
        trigger,
        'capture-1',
        'testing something unrelated',
        'doubtful',
        'This is about testing, not the route intent'
      );

      expect(signal.signalType).toBe('validation_doubtful');
      expect(signal.triggerPattern).toBe('^test');
      expect(signal.details).toContain('testing');
    });

    it('should record reject validation signal', async () => {
      const route: Route = {
        id: 'route-test',
        name: 'test_route',
        description: 'Test',
        triggers: [createTrigger('^test')],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'test.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };
      const trigger = createTrigger('^test');

      const signal = await hygiene.recordValidationSignal(
        route,
        trigger,
        'capture-1',
        'completely wrong input',
        'reject',
        'Definitely does not belong'
      );

      expect(signal.signalType).toBe('validation_reject');
    });
  });

  describe('recordUserCorrection', () => {
    it('should record user correction signal', async () => {
      const route: Route = {
        id: 'route-test',
        name: 'test_route',
        description: 'Test',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'test.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };

      const signal = await hygiene.recordUserCorrection(
        route,
        'capture-1',
        'misrouted input',
        'User said this should go to other_route'
      );

      expect(signal.signalType).toBe('user_correction');
      expect(signal.triggerPattern).toBeNull();
      expect(signal.details).toContain('other_route');
    });
  });

  describe('computeRouteStats', () => {
    it('should compute trigger statistics and recommendations', () => {
      const route: Route = {
        id: 'route-test',
        name: 'test_route',
        description: 'Test',
        triggers: [
          createTrigger('^test', {
            status: 'live',
            stats: {
              totalFires: 10,
              lastFired: new Date().toISOString(),
              validationResults: {
                certain: 3,
                confident: 2,
                plausible: 1,
                unsure: 0,
                doubtful: 3,
                reject: 1,
              },
            },
          }),
        ],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'test.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };

      const report = hygiene.computeRouteStats(route, []);

      expect(report.triggerStats).toHaveLength(1);
      expect(report.triggerStats[0].totalFires).toBe(10);
      expect(report.triggerStats[0].rejectRate).toBe(0.4); // (3+1)/10
      expect(report.recommendations.some(r => r.includes('rejection rate'))).toBe(true);
    });

    it('should flag stale triggers', () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
      const route: Route = {
        id: 'route-test',
        name: 'test_route',
        description: 'Test',
        triggers: [
          createTrigger('^stale', {
            status: 'live',
            stats: {
              totalFires: 5,
              lastFired: oldDate,
              validationResults: {
                certain: 5,
                confident: 0,
                plausible: 0,
                unsure: 0,
                doubtful: 0,
                reject: 0,
              },
            },
          }),
        ],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'test.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };

      const report = hygiene.computeRouteStats(route, []);

      expect(report.triggerStats[0].isStale).toBe(true);
      expect(report.recommendations.some(r => r.includes("hasn't fired in 30+ days"))).toBe(true);
    });

    it('should flag triggers that never fired', () => {
      const route: Route = {
        id: 'route-test',
        name: 'test_route',
        description: 'Test',
        triggers: [
          createTrigger('^never', { status: 'live' }),
        ],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'test.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };

      const report = hygiene.computeRouteStats(route, []);

      expect(report.triggerStats[0].totalFires).toBe(0);
      expect(report.recommendations.some(r => r.includes('has never fired'))).toBe(true);
    });
  });

  describe('getRoutesNeedingReview', () => {
    it('should return routes with recent hygiene signals', async () => {
      // Create routes
      const route1: Route = {
        id: 'route-1',
        name: 'route_one',
        description: 'Test 1',
        triggers: [createTrigger('^one')],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'one.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };
      const route2: Route = {
        id: 'route-2',
        name: 'route_two',
        description: 'Test 2',
        triggers: [createTrigger('^two')],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'two.txt' },
        transformScript: null,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        lastUsed: null,
      };

      // Add signal for route1 only
      await hygiene.recordSignal({
        routeId: 'route-1',
        routeName: 'route_one',
        triggerPattern: '^one',
        signalType: 'validation_reject',
        captureId: 'capture-1',
        input: 'test',
        details: 'Test rejection',
      });

      const reports = await hygiene.getRoutesNeedingReview([route1, route2]);

      expect(reports).toHaveLength(1);
      expect(reports[0].routeId).toBe('route-1');
      expect(reports[0].recentSignals).toHaveLength(1);
    });
  });
});
