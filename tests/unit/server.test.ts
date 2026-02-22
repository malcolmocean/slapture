// tests/unit/server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/server/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route } from '../../src/types.js';
import fs from 'fs';
import type { Hono } from 'hono';

const TEST_DATA_DIR = './test-server-data';
const TEST_FILESTORE = './test-server-filestore';

describe('HTTP Server', () => {
  let app: Hono;
  let storage: Storage;

  beforeAll(async () => {
    storage = new Storage(TEST_DATA_DIR);
    await storage.saveConfig({
      authToken: 'test-token',
      requireApproval: false,
      approvalGuardPrompt: null,
      mastermindRetryAttempts: 3,
    });

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

    app = await buildServer(storage, TEST_FILESTORE, 'test-api-key');
  });

  afterAll(async () => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('POST /capture', () => {
    it('should require auth token', async () => {
      const response = await app.request('/capture', {
        method: 'POST',
        body: JSON.stringify({ text: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(401);
    });

    it('should accept capture with valid token', async () => {
      const response = await app.request('/capture?token=test-token', {
        method: 'POST',
        body: JSON.stringify({ text: 'dump: hello' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.captureId).toBeDefined();
    });

    it('should reject missing text', async () => {
      const response = await app.request('/capture?token=test-token', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /status/:captureId', () => {
    it('should return capture status', async () => {
      const createResponse = await app.request('/capture?token=test-token', {
        method: 'POST',
        body: JSON.stringify({ text: 'dump: test status' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const { captureId } = await createResponse.json();

      const statusResponse = await app.request(`/status/${captureId}?token=test-token`);

      expect(statusResponse.status).toBe(200);
      const status = await statusResponse.json();
      expect(status.id).toBe(captureId);
    });

    it('should return 404 for unknown capture', async () => {
      const response = await app.request('/status/nonexistent?token=test-token');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /routes', () => {
    it('should list routes', async () => {
      const response = await app.request('/routes?token=test-token');

      expect(response.status).toBe(200);
      const routes = await response.json();
      expect(Array.isArray(routes)).toBe(true);
    });
  });

  describe('GET /captures', () => {
    it('should list recent captures', async () => {
      const response = await app.request('/captures?token=test-token');

      expect(response.status).toBe(200);
      const captures = await response.json();
      expect(Array.isArray(captures)).toBe(true);
    });
  });
});
