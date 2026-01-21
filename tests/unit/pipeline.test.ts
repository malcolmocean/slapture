// tests/unit/pipeline.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapturePipeline } from '../../src/pipeline/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route } from '../../src/types.js';
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
  });
});
