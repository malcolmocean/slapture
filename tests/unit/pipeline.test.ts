// tests/unit/pipeline.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapturePipeline } from '../../src/pipeline/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route, Capture } from '../../src/types.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-pipeline-data';
const TEST_FILESTORE = './test-pipeline-filestore';

// Mock Mastermind
vi.mock('../../src/mastermind/index.js', () => ({
  Mastermind: class MockMastermind {
    async consult() {
      return {
        action: 'create',
        route: {
          name: 'newroute',
          description: 'Auto-created route',
          triggers: [{ type: 'keyword', pattern: 'test', priority: 5 }],
          destinationType: 'fs',
          destinationConfig: { filePath: 'new.txt' },
          transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
          schema: null,
          createdBy: 'mastermind',
        },
        reason: 'Created new route',
      };
    }
  },
}));

describe('CapturePipeline', () => {
  let pipeline: CapturePipeline;
  let storage: Storage;

  beforeEach(async () => {
    storage = new Storage(TEST_DATA_DIR);

    // Create test routes
    const dumpRoute: Route = {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump text',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'user',
      lastUsed: null,
    };
    await storage.saveRoute(dumpRoute);

    pipeline = new CapturePipeline(storage, TEST_FILESTORE, 'test-api-key');
  });

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('full pipeline', () => {
    it('should process capture with explicit route', async () => {
      const result = await pipeline.process('dump: hello world', 'testuser');

      expect(result.capture.executionResult).toBe('success');
      expect(result.capture.routeFinal).toBe('route-dump');

      const fileContent = fs.readFileSync(
        `${TEST_FILESTORE}/testuser/dump.txt`,
        'utf-8'
      );
      expect(fileContent).toBe('hello world\n');
    });

    it('should save capture to storage', async () => {
      const result = await pipeline.process('dump: test', 'testuser');

      const saved = await storage.getCapture(result.capture.id);
      expect(saved).not.toBeNull();
      expect(saved?.raw).toBe('dump: test');
    });

    it('should record execution trace', async () => {
      const result = await pipeline.process('dump: test', 'testuser');

      expect(result.capture.executionTrace.length).toBeGreaterThan(0);
      expect(result.capture.executionTrace.some(s => s.step === 'parse')).toBe(true);
      expect(result.capture.executionTrace.some(s => s.step === 'dispatch')).toBe(true);
      expect(result.capture.executionTrace.some(s => s.step === 'execute')).toBe(true);
    });

    it('should store username on capture object', async () => {
      const result = await pipeline.process('dump: test capture', 'malcolm');
      expect(result.capture.username).toBe('malcolm');

      // Verify it's also saved to storage correctly
      const saved = await storage.getCapture(result.capture.id);
      expect(saved?.username).toBe('malcolm');
    });
  });

  describe('pipeline string transform for non-fs destinations', () => {
    it('should run transformScript and set transformedPayload for non-fs destination', async () => {
      // Create a route with a notes destination and a transformScript
      // Use a trigger pattern that matches without the colon-prefix syntax
      // (colon syntax causes the parser to treat it as an explicit route name)
      const notesRoute: Route = {
        id: 'route-notes-transform',
        name: 'notes-transform',
        description: 'Notes with transform',
        triggers: [{ type: 'regex' as const, pattern: '^MEMO\\b', priority: 10 }],
        schema: null,
        recentItems: [],
        destinationType: 'notes',
        destinationConfig: { target: 'integration', id: 'notes' },
        transformScript: "result = payload.toUpperCase();",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };
      await storage.saveRoute(notesRoute);

      // Re-create pipeline so it picks up the new route
      pipeline = new CapturePipeline(storage, TEST_FILESTORE, 'test-api-key');

      // Input without colon so parser doesn't treat "MEMO" as explicit route
      const result = await pipeline.process('MEMO remember this', 'testuser');

      expect(result.capture.transformedPayload).toBe('MEMO REMEMBER THIS');
    });

    it('should NOT run pipeline transform for fs destinations', async () => {
      // The existing dump route is fs - its transform is imperative (handled by executor)
      const result = await pipeline.process('dump: hello world', 'testuser');

      // fs destinations do NOT get pipeline transform - transformedPayload should be undefined/null
      expect(result.capture.transformedPayload).toBeUndefined();
    });
  });

  describe('matchedTrigger stored on capture', () => {
    it('should store matchedTrigger pattern when a trigger matches', async () => {
      // Create a route with a regex trigger (not explicit route match)
      const regexRoute: Route = {
        id: 'route-regex-match',
        name: 'regex-match',
        description: 'Regex matched route',
        triggers: [{ type: 'regex' as const, pattern: '^weight\\s+\\d+', priority: 10 }],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'weight.txt' },
        transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };
      await storage.saveRoute(regexRoute);

      pipeline = new CapturePipeline(storage, TEST_FILESTORE, 'test-api-key');

      const result = await pipeline.process('weight 185', 'testuser');

      expect(result.capture.matchedTrigger).toBe('^weight\\s+\\d+');
    });

    it('should not set matchedTrigger for explicit route matches', async () => {
      const result = await pipeline.process('dump: hello', 'testuser');

      // Explicit route match doesn't go through trigger matching — matchedTrigger is null
      expect(result.capture.matchedTrigger).toBeNull();
    });
  });

  describe('retryCapture', () => {
    it('should use stored username in retryCapture', async () => {
      // Create a capture that was blocked (simulating OAuth required scenario)
      const capture: Capture = {
        id: 'retry-test',
        raw: 'dump: retry test',
        timestamp: new Date().toISOString(),
        username: 'retryuser',
        parsed: { explicitRoute: 'dump', payload: 'retry test', metadata: {} },
        routeProposed: 'route-dump',
        routeConfidence: 'high',
        routeFinal: 'route-dump',
        executionTrace: [],
        executionResult: 'blocked_needs_auth',
        verificationState: 'pending',
        retiredFromTests: false,
        retiredReason: null,
      };

      await storage.saveCapture(capture, 'retryuser');

      // Retry should use capture.username, not hardcoded 'default'
      const result = await pipeline.retryCapture(capture);

      // Verify the capture still has the correct username
      expect(result.capture.username).toBe('retryuser');

      // Verify the file was written to the user-specific path
      const fileContent = fs.readFileSync(
        `${TEST_FILESTORE}/retryuser/dump.txt`,
        'utf-8'
      );
      expect(fileContent).toBe('retry test\n');
    });

    it('should use stored username when route no longer exists', async () => {
      // Create a capture with a non-existent route
      const capture: Capture = {
        id: 'retry-no-route',
        raw: 'nonexistent: test',
        timestamp: new Date().toISOString(),
        username: 'orphanuser',
        parsed: { explicitRoute: 'nonexistent', payload: 'test', metadata: {} },
        routeProposed: 'route-nonexistent',
        routeConfidence: 'high',
        routeFinal: 'route-nonexistent',
        executionTrace: [],
        executionResult: 'blocked_needs_auth',
        verificationState: 'pending',
        retiredFromTests: false,
        retiredReason: null,
      };

      await storage.saveCapture(capture, 'orphanuser');

      // Retry should fail gracefully but still use the correct username
      const result = await pipeline.retryCapture(capture);

      expect(result.capture.executionResult).toBe('failed');
      expect(result.capture.username).toBe('orphanuser');

      // Verify the capture was saved under the correct user
      const saved = await storage.getCapture('retry-no-route');
      expect(saved?.username).toBe('orphanuser');
    });
  });
});
