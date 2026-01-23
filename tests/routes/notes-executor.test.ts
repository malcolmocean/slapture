// tests/routes/notes-executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { NotesExecutor } from '../../src/routes/notes-executor';
import { Storage } from '../../src/storage';
import type { Route, Capture } from '../../src/types';

describe('NotesExecutor', () => {
  let storage: Storage;
  let executor: NotesExecutor;
  const testDir = './test-data-notes-executor';

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    storage = new Storage(testDir);
    executor = new NotesExecutor(storage);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const createRoute = (target: 'integration' | 'destination', id: string): Route => ({
    id: 'route-notes',
    name: 'notes',
    description: 'Save to notes',
    triggers: [{ type: 'prefix', pattern: 'note', priority: 10 }],
    schema: null,
    recentItems: [],
    destinationType: 'notes' as any,
    destinationConfig: { target, id },
    transformScript: null,
    createdAt: new Date().toISOString(),
    createdBy: 'user',
    lastUsed: null
  });

  const createCapture = (username: string, payload: string): Capture => ({
    id: 'capture-1',
    raw: `note: ${payload}`,
    timestamp: new Date().toISOString(),
    username,
    parsed: { explicitRoute: 'notes', payload, metadata: {} },
    routeProposed: 'route-notes',
    routeConfidence: 'high',
    routeFinal: 'route-notes',
    executionTrace: [],
    executionResult: 'pending',
    verificationState: 'pending',
    retiredFromTests: false,
    retiredReason: null
  });

  describe('integration target', () => {
    it('should save note to integration location', async () => {
      const route = createRoute('integration', 'my-integration');
      const capture = createCapture('testuser', 'Hello world');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      // Verify the note was saved
      const savedNote = await storage.getIntegrationNote('testuser', 'my-integration');
      expect(savedNote).toBe('Hello world');
    });

    it('should append to existing integration note by default', async () => {
      // Setup existing note
      await storage.saveIntegrationNote('testuser', 'my-integration', 'First line');

      const route = createRoute('integration', 'my-integration');
      const capture = createCapture('testuser', 'Second line');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getIntegrationNote('testuser', 'my-integration');
      expect(savedNote).toBe('First line\nSecond line');
    });

    it('should overwrite when payload starts with REPLACE:', async () => {
      // Setup existing note
      await storage.saveIntegrationNote('testuser', 'my-integration', 'Old content');

      const route = createRoute('integration', 'my-integration');
      const capture = createCapture('testuser', 'REPLACE:New content only');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getIntegrationNote('testuser', 'my-integration');
      expect(savedNote).toBe('New content only');
    });
  });

  describe('destination target', () => {
    it('should save note to destination location', async () => {
      const route = createRoute('destination', 'my-destination');
      const capture = createCapture('testuser', 'Destination note');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getDestinationNote('testuser', 'my-destination');
      expect(savedNote).toBe('Destination note');
    });

    it('should append to existing destination note by default', async () => {
      // Setup existing note
      await storage.saveDestinationNote('testuser', 'my-destination', 'Line A');

      const route = createRoute('destination', 'my-destination');
      const capture = createCapture('testuser', 'Line B');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getDestinationNote('testuser', 'my-destination');
      expect(savedNote).toBe('Line A\nLine B');
    });

    it('should overwrite when payload starts with REPLACE:', async () => {
      // Setup existing note
      await storage.saveDestinationNote('testuser', 'my-destination', 'Old dest content');

      const route = createRoute('destination', 'my-destination');
      const capture = createCapture('testuser', 'REPLACE:New dest content');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getDestinationNote('testuser', 'my-destination');
      expect(savedNote).toBe('New dest content');
    });
  });

  describe('edge cases', () => {
    it('should use raw capture when parsed payload is missing', async () => {
      const route = createRoute('integration', 'test-int');
      const capture = createCapture('testuser', '');
      capture.parsed = null;
      capture.raw = 'Raw note content';

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getIntegrationNote('testuser', 'test-int');
      expect(savedNote).toBe('Raw note content');
    });

    it('should handle REPLACE: prefix case-sensitively', async () => {
      await storage.saveIntegrationNote('testuser', 'test-int', 'Existing');

      const route = createRoute('integration', 'test-int');
      // Lowercase 'replace:' should NOT trigger overwrite
      const capture = createCapture('testuser', 'replace:not a replace');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getIntegrationNote('testuser', 'test-int');
      expect(savedNote).toBe('Existing\nreplace:not a replace');
    });

    it('should return failed status for invalid target type', async () => {
      const route = createRoute('integration', 'test');
      // Manually set an invalid target
      (route.destinationConfig as any).target = 'invalid';

      const capture = createCapture('testuser', 'Test');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Unknown target type');
    });

    it('should handle empty existing note during append', async () => {
      // No existing note yet
      const route = createRoute('integration', 'new-int');
      const capture = createCapture('testuser', 'First content');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getIntegrationNote('testuser', 'new-int');
      expect(savedNote).toBe('First content');
    });

    it('should handle whitespace in REPLACE: prefix', async () => {
      await storage.saveIntegrationNote('testuser', 'test-int', 'Old');

      const route = createRoute('integration', 'test-int');
      // REPLACE: with space after colon
      const capture = createCapture('testuser', 'REPLACE: Spaced content');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');

      const savedNote = await storage.getIntegrationNote('testuser', 'test-int');
      // Should keep the space after colon in content
      expect(savedNote).toBe(' Spaced content');
    });
  });

  describe('per-user isolation', () => {
    it('should isolate notes between users', async () => {
      const route = createRoute('integration', 'shared-int');

      const capture1 = createCapture('user1', 'User 1 note');
      const capture2 = createCapture('user2', 'User 2 note');

      await executor.execute(route, capture1);
      await executor.execute(route, capture2);

      const user1Note = await storage.getIntegrationNote('user1', 'shared-int');
      const user2Note = await storage.getIntegrationNote('user2', 'shared-int');

      expect(user1Note).toBe('User 1 note');
      expect(user2Note).toBe('User 2 note');
    });
  });
});
