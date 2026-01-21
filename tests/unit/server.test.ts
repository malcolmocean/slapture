// tests/unit/server.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../src/server/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route } from '../../src/types.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-server-data';
const TEST_FILESTORE = './test-server-filestore';

describe('HTTP Server', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let storage: Storage;

  beforeAll(async () => {
    storage = new Storage(TEST_DATA_DIR);
    await storage.saveConfig({
      authToken: 'test-token',
      requireApproval: false,
      approvalGuardPrompt: null,
      mastermindRetryAttempts: 3,
    });

    // Create a test route
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

    server = await buildServer(storage, TEST_FILESTORE, 'test-api-key');
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('POST /capture', () => {
    it('should require auth token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/capture',
        payload: { text: 'test' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should accept capture with valid token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/capture?token=test-token',
        payload: { text: 'dump: hello' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.captureId).toBeDefined();
    });

    it('should reject missing text', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/capture?token=test-token',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /status/:captureId', () => {
    it('should return capture status', async () => {
      // First create a capture
      const createResponse = await server.inject({
        method: 'POST',
        url: '/capture?token=test-token',
        payload: { text: 'dump: test status' },
      });
      const { captureId } = JSON.parse(createResponse.body);

      // Then get its status
      const statusResponse = await server.inject({
        method: 'GET',
        url: `/status/${captureId}?token=test-token`,
      });

      expect(statusResponse.statusCode).toBe(200);
      const status = JSON.parse(statusResponse.body);
      expect(status.id).toBe(captureId);
    });

    it('should return 404 for unknown capture', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/status/nonexistent?token=test-token',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /routes', () => {
    it('should list routes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/routes?token=test-token',
      });

      expect(response.statusCode).toBe(200);
      const routes = JSON.parse(response.body);
      expect(Array.isArray(routes)).toBe(true);
    });
  });

  describe('GET /captures', () => {
    it('should list recent captures', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/captures?token=test-token',
      });

      expect(response.statusCode).toBe(200);
      const captures = JSON.parse(response.body);
      expect(Array.isArray(captures)).toBe(true);
    });
  });
});
