// tests/unit/executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RouteExecutor } from '../../src/routes/executor.js';
import { Route } from '../../src/types.js';
import fs from 'fs';
import path from 'path';

const TEST_FILESTORE = './test-filestore';
const TEST_USER = 'testuser';

describe('RouteExecutor', () => {
  let executor: RouteExecutor;

  beforeEach(() => {
    executor = new RouteExecutor(TEST_FILESTORE);
    fs.mkdirSync(path.join(TEST_FILESTORE, TEST_USER), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('text append', () => {
    it('should append text to file', async () => {
      const route: Route = {
        id: 'route-1',
        name: 'dump',
        description: 'Dump text',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'dump.txt' },
        transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'hello world', TEST_USER, {});

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'dump.txt'),
        'utf-8'
      );
      expect(content).toBe('hello world\n');
    });

    it('should append multiple entries', async () => {
      const route: Route = {
        id: 'route-1',
        name: 'dump',
        description: 'Dump text',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'dump.txt' },
        transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'first', TEST_USER, {});
      await executor.execute(route, 'second', TEST_USER, {});

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'dump.txt'),
        'utf-8'
      );
      expect(content).toBe('first\nsecond\n');
    });
  });

  describe('json operations', () => {
    it('should update json map', async () => {
      const route: Route = {
        id: 'route-2',
        name: 'notes',
        description: 'Save notes',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'notes.json' },
        transformScript: `
          let data = {};
          if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          }
          data[timestamp] = payload;
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        `,
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'test note', TEST_USER, {}, '2026-01-21T12:00:00Z');

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'notes.json'),
        'utf-8'
      );
      const data = JSON.parse(content);
      expect(data['2026-01-21T12:00:00Z']).toBe('test note');
    });
  });

  describe('path validation', () => {
    it('should reject paths outside filestore', async () => {
      const route: Route = {
        id: 'route-evil',
        name: 'evil',
        description: 'Try to escape',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: '../../../etc/passwd' },
        transformScript: "fs.writeFileSync(filePath, 'hacked')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await expect(
        executor.execute(route, 'payload', TEST_USER, {})
      ).rejects.toThrow('Path validation failed');
    });
  });

  describe('metadata access', () => {
    it('should provide metadata to transform script', async () => {
      const route: Route = {
        id: 'route-meta',
        name: 'meta',
        description: 'Use metadata',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'meta.txt' },
        transformScript: "fs.writeFileSync(filePath, `${payload} from ${metadata.source}`)",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'hello', TEST_USER, { source: 'Bob' });

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'meta.txt'),
        'utf-8'
      );
      expect(content).toBe('hello from Bob');
    });
  });
});
