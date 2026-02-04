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

  describe('Token migration', () => {
    it('should migrate global tokens to default user on first access', async () => {
      // Setup: write tokens in old global format
      const globalConfig = {
        authToken: 'dev-token',
        requireApproval: false,
        integrations: {
          intend: {
            accessToken: 'old-global-token',
            refreshToken: 'old-refresh',
            expiresAt: '2030-01-01T00:00:00Z',
            baseUrl: 'https://intend.do'
          }
        }
      };
      fs.writeFileSync(
        path.join(TEST_DATA_DIR, 'config.json'),
        JSON.stringify(globalConfig, null, 2)
      );

      // Trigger migration
      await storage.migrateGlobalTokensIfNeeded();

      // Verify tokens moved to default user
      const userTokens = await storage.getIntendTokens('default');
      expect(userTokens?.accessToken).toBe('old-global-token');

      // Verify global config no longer has tokens
      const newGlobalConfig = JSON.parse(
        fs.readFileSync(path.join(TEST_DATA_DIR, 'config.json'), 'utf-8')
      );
      expect(newGlobalConfig.integrations?.intend).toBeUndefined();
    });

    it('should not migrate if already migrated', async () => {
      // Setup: user already has tokens
      await storage.saveIntendTokens('default', {
        accessToken: 'user-token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      // Old global config with different token
      const globalConfig = {
        authToken: 'dev-token',
        integrations: {
          intend: {
            accessToken: 'should-not-overwrite',
            refreshToken: 'old',
            expiresAt: '2030-01-01T00:00:00Z',
            baseUrl: 'https://intend.do'
          }
        }
      };
      fs.writeFileSync(
        path.join(TEST_DATA_DIR, 'config.json'),
        JSON.stringify(globalConfig, null, 2)
      );

      await storage.migrateGlobalTokensIfNeeded();

      // User tokens should be unchanged
      const userTokens = await storage.getIntendTokens('default');
      expect(userTokens?.accessToken).toBe('user-token');
    });

    it('should clean up global config when user tokens already exist', async () => {
      // Setup: user already has tokens
      await storage.saveIntendTokens('default', {
        accessToken: 'user-token',
        refreshToken: 'refresh',
        expiresAt: '2030-01-01T00:00:00Z',
        baseUrl: 'https://intend.do'
      });

      // Old global config with different token
      const globalConfig = {
        authToken: 'dev-token',
        integrations: {
          intend: {
            accessToken: 'should-not-overwrite',
            refreshToken: 'old',
            expiresAt: '2030-01-01T00:00:00Z',
            baseUrl: 'https://intend.do'
          }
        }
      };
      fs.writeFileSync(
        path.join(TEST_DATA_DIR, 'config.json'),
        JSON.stringify(globalConfig, null, 2)
      );

      await storage.migrateGlobalTokensIfNeeded();

      // Global config should have integrations cleaned up
      const newGlobalConfig = JSON.parse(
        fs.readFileSync(path.join(TEST_DATA_DIR, 'config.json'), 'utf-8')
      );
      expect(newGlobalConfig.integrations?.intend).toBeUndefined();
    });

    it('should do nothing when no global config exists', async () => {
      // No setup - no global config file
      await storage.migrateGlobalTokensIfNeeded();

      // Should not throw, and no tokens exist
      const tokens = await storage.getIntendTokens('default');
      expect(tokens).toBeNull();
    });

    it('should do nothing when global config has no intend tokens', async () => {
      const globalConfig = {
        authToken: 'dev-token',
        requireApproval: false
      };
      fs.writeFileSync(
        path.join(TEST_DATA_DIR, 'config.json'),
        JSON.stringify(globalConfig, null, 2)
      );

      await storage.migrateGlobalTokensIfNeeded();

      // Should not throw, and no tokens exist
      const tokens = await storage.getIntendTokens('default');
      expect(tokens).toBeNull();
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

  describe('Integration Notes', () => {
    it('should save and retrieve an integration note', async () => {
      const noteContent = 'This is my note about the intend integration';
      await storage.saveIntegrationNote('malcolm', 'intend', noteContent);

      const retrieved = await storage.getIntegrationNote('malcolm', 'intend');
      expect(retrieved).toBe(noteContent);
    });

    it('should return null for non-existent integration note', async () => {
      const note = await storage.getIntegrationNote('malcolm', 'nonexistent');
      expect(note).toBeNull();
    });

    it('should store integration notes in correct path', async () => {
      await storage.saveIntegrationNote('testuser', 'slack', 'Slack integration note');

      const notePath = path.join(TEST_DATA_DIR, 'users', 'testuser', 'notes', 'integrations', 'slack.txt');
      expect(fs.existsSync(notePath)).toBe(true);
      expect(fs.readFileSync(notePath, 'utf-8')).toBe('Slack integration note');
    });

    it('should overwrite existing integration note', async () => {
      await storage.saveIntegrationNote('malcolm', 'intend', 'Original note');
      await storage.saveIntegrationNote('malcolm', 'intend', 'Updated note');

      const retrieved = await storage.getIntegrationNote('malcolm', 'intend');
      expect(retrieved).toBe('Updated note');
    });

    it('should validate username for integration notes', async () => {
      await expect(storage.saveIntegrationNote('../evil', 'intend', 'note'))
        .rejects.toThrow('Invalid username');
      await expect(storage.getIntegrationNote('../evil', 'intend'))
        .rejects.toThrow('Invalid username');
    });

    it('should keep notes separate between users', async () => {
      await storage.saveIntegrationNote('user1', 'intend', 'User 1 note');
      await storage.saveIntegrationNote('user2', 'intend', 'User 2 note');

      expect(await storage.getIntegrationNote('user1', 'intend')).toBe('User 1 note');
      expect(await storage.getIntegrationNote('user2', 'intend')).toBe('User 2 note');
    });
  });

  describe('Destination Notes', () => {
    it('should save and retrieve a destination note', async () => {
      const noteContent = 'This is my note about the dump destination';
      await storage.saveDestinationNote('malcolm', 'dump-route', noteContent);

      const retrieved = await storage.getDestinationNote('malcolm', 'dump-route');
      expect(retrieved).toBe(noteContent);
    });

    it('should return null for non-existent destination note', async () => {
      const note = await storage.getDestinationNote('malcolm', 'nonexistent');
      expect(note).toBeNull();
    });

    it('should store destination notes in correct path', async () => {
      await storage.saveDestinationNote('testuser', 'notes-route', 'Notes route description');

      const notePath = path.join(TEST_DATA_DIR, 'users', 'testuser', 'notes', 'destinations', 'notes-route.txt');
      expect(fs.existsSync(notePath)).toBe(true);
      expect(fs.readFileSync(notePath, 'utf-8')).toBe('Notes route description');
    });

    it('should sanitize destination IDs with slashes', async () => {
      await storage.saveDestinationNote('malcolm', 'project/tasks/inbox', 'Nested destination');

      // The slash should be replaced with underscore
      const notePath = path.join(TEST_DATA_DIR, 'users', 'malcolm', 'notes', 'destinations', 'project_tasks_inbox.txt');
      expect(fs.existsSync(notePath)).toBe(true);

      // Should retrieve using original ID
      const retrieved = await storage.getDestinationNote('malcolm', 'project/tasks/inbox');
      expect(retrieved).toBe('Nested destination');
    });

    it('should sanitize destination IDs with backslashes', async () => {
      await storage.saveDestinationNote('malcolm', 'folder\\subfolder', 'Backslash destination');

      const notePath = path.join(TEST_DATA_DIR, 'users', 'malcolm', 'notes', 'destinations', 'folder_subfolder.txt');
      expect(fs.existsSync(notePath)).toBe(true);

      const retrieved = await storage.getDestinationNote('malcolm', 'folder\\subfolder');
      expect(retrieved).toBe('Backslash destination');
    });

    it('should sanitize destination IDs with colons', async () => {
      await storage.saveDestinationNote('malcolm', 'intend:project:123', 'Colon destination');

      const notePath = path.join(TEST_DATA_DIR, 'users', 'malcolm', 'notes', 'destinations', 'intend_project_123.txt');
      expect(fs.existsSync(notePath)).toBe(true);

      const retrieved = await storage.getDestinationNote('malcolm', 'intend:project:123');
      expect(retrieved).toBe('Colon destination');
    });

    it('should validate username for destination notes', async () => {
      await expect(storage.saveDestinationNote('../evil', 'route', 'note'))
        .rejects.toThrow('Invalid username');
      await expect(storage.getDestinationNote('../evil', 'route'))
        .rejects.toThrow('Invalid username');
    });

    it('should keep notes separate between users', async () => {
      await storage.saveDestinationNote('user1', 'route', 'User 1 note');
      await storage.saveDestinationNote('user2', 'route', 'User 2 note');

      expect(await storage.getDestinationNote('user1', 'route')).toBe('User 1 note');
      expect(await storage.getDestinationNote('user2', 'route')).toBe('User 2 note');
    });

    it('should handle empty destination ID gracefully', async () => {
      // Empty ID should still work with sanitization
      await storage.saveDestinationNote('malcolm', '', 'Empty ID note');
      const retrieved = await storage.getDestinationNote('malcolm', '');
      expect(retrieved).toBe('Empty ID note');
    });
  });

  describe('sanitizeId helper', () => {
    it('should handle various unsafe characters', async () => {
      // Test multiple unsafe characters in one ID
      await storage.saveDestinationNote('malcolm', 'a/b\\c:d*e?f"g<h>i|j', 'Complex ID');

      const notePath = path.join(TEST_DATA_DIR, 'users', 'malcolm', 'notes', 'destinations', 'a_b_c_d_e_f_g_h_i_j.txt');
      expect(fs.existsSync(notePath)).toBe(true);

      const retrieved = await storage.getDestinationNote('malcolm', 'a/b\\c:d*e?f"g<h>i|j');
      expect(retrieved).toBe('Complex ID');
    });
  });

  describe('Trigger Change Reviews', () => {
    const createTestReview = (overrides: Partial<import('../../src/types.js').TriggerChangeReview> = {}): import('../../src/types.js').TriggerChangeReview => ({
      id: 'review-1',
      routeId: 'gwen-memories',
      proposedTriggers: [{ type: 'regex', pattern: '^gwen\\s+memory', priority: 10 }],
      evolverReasoning: 'Improved pattern to be more specific',
      createdAt: '2026-01-29T12:00:00Z',
      status: 'pending',
      affectedCaptures: [
        {
          captureId: 'cap-1',
          raw: 'log today pushups to pushups.csv: 10',
          routedAt: '2026-01-15T10:00:00Z',
          recommendation: 'RE_ROUTE',
          suggestedReroute: 'pushups',
          reasoning: 'This is about pushups, not gwen memories',
        },
      ],
      ...overrides,
    });

    it('should save and retrieve a trigger change review', async () => {
      const review = createTestReview();

      await storage.saveTriggerReview(review);
      const retrieved = await storage.getTriggerReview('review-1');

      expect(retrieved).toEqual(review);
    });

    it('should return null for non-existent review', async () => {
      const retrieved = await storage.getTriggerReview('does-not-exist');
      expect(retrieved).toBeNull();
    });

    it('should list all trigger change reviews', async () => {
      const review1 = createTestReview({ id: 'review-1' });
      const review2 = createTestReview({ id: 'review-2', status: 'approved' });
      const review3 = createTestReview({ id: 'review-3', status: 'rejected' });

      await storage.saveTriggerReview(review1);
      await storage.saveTriggerReview(review2);
      await storage.saveTriggerReview(review3);

      const all = await storage.listTriggerReviews();
      expect(all).toHaveLength(3);
    });

    it('should list only pending trigger change reviews', async () => {
      const review1 = createTestReview({ id: 'review-1', status: 'pending' });
      const review2 = createTestReview({ id: 'review-2', status: 'approved' });
      const review3 = createTestReview({ id: 'review-3', status: 'pending' });

      await storage.saveTriggerReview(review1);
      await storage.saveTriggerReview(review2);
      await storage.saveTriggerReview(review3);

      const pending = await storage.listTriggerReviews('pending');
      expect(pending).toHaveLength(2);
      expect(pending.every(r => r.status === 'pending')).toBe(true);
    });

    it('should update review status to approved', async () => {
      const review = createTestReview({ id: 'review-1', status: 'pending' });

      await storage.saveTriggerReview(review);
      await storage.updateTriggerReviewStatus('review-1', 'approved');

      const updated = await storage.getTriggerReview('review-1');
      expect(updated?.status).toBe('approved');
    });

    it('should update review status to rejected', async () => {
      const review = createTestReview({ id: 'review-1', status: 'pending' });

      await storage.saveTriggerReview(review);
      await storage.updateTriggerReviewStatus('review-1', 'rejected');

      const updated = await storage.getTriggerReview('review-1');
      expect(updated?.status).toBe('rejected');
    });

    it('should return false when updating non-existent review', async () => {
      const result = await storage.updateTriggerReviewStatus('does-not-exist', 'approved');
      expect(result).toBe(false);
    });

    it('should store reviews in trigger-reviews directory', async () => {
      const review = createTestReview({ id: 'review-xyz' });
      await storage.saveTriggerReview(review);

      const filePath = path.join(TEST_DATA_DIR, 'trigger-reviews', 'review-xyz.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should delete a trigger change review', async () => {
      const review = createTestReview({ id: 'review-to-delete' });
      await storage.saveTriggerReview(review);

      // Verify it exists
      expect(await storage.getTriggerReview('review-to-delete')).not.toBeNull();

      await storage.deleteTriggerReview('review-to-delete');

      // Verify it's gone
      expect(await storage.getTriggerReview('review-to-delete')).toBeNull();
    });

    it('should not throw when deleting non-existent review', async () => {
      await expect(storage.deleteTriggerReview('does-not-exist')).resolves.not.toThrow();
    });
  });
});
