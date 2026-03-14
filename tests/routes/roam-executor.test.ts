// tests/routes/roam-executor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK before importing anything that uses it
vi.mock('@roam-research/roam-api-sdk', () => ({
  initializeGraph: vi.fn(),
  q: vi.fn(),
  pull: vi.fn(),
  createBlock: vi.fn(),
  createPage: vi.fn(),
}));

import { RoamExecutor } from '../../src/routes/roam-executor';
import { RoamClient } from '../../src/integrations/roam/client';
import type { StorageInterface } from '../../src/storage/interface';
import type { Route, Capture, RoamConfig } from '../../src/types';
import type { RoamDestinationConfig } from '../../src/integrations/roam/types';

function createMockStorage(roamConfig: RoamConfig | null = null): StorageInterface {
  return {
    getRoamConfig: vi.fn().mockResolvedValue(roamConfig),
  } as unknown as StorageInterface;
}

function createCapture(raw: string, payload?: string): Capture {
  return {
    id: 'test-capture-1',
    raw,
    timestamp: new Date().toISOString(),
    username: 'testuser',
    parsed: {
      explicitRoute: null,
      payload: payload ?? raw,
      metadata: {},
    },
    routeProposed: null,
    routeConfidence: null,
    routeFinal: null,
    executionTrace: [],
    executionResult: 'pending',
    verificationState: 'pending',
    retiredFromTests: false,
    retiredReason: null,
  };
}

function createRoute(config: RoamDestinationConfig): Route {
  return {
    id: 'roam-route-1',
    name: 'Test Roam Route',
    description: 'Test route',
    triggers: [],
    schema: null,
    recentItems: [],
    destinationType: 'roam',
    destinationConfig: config,
    transformScript: null,
    createdAt: new Date().toISOString(),
    createdBy: 'user',
    lastUsed: null,
  };
}

describe('RoamExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth checks', () => {
    it('returns blocked_needs_auth when no roam config', async () => {
      const storage = createMockStorage(null);
      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'daily_tagged', tag: '#memories' },
      });
      const capture = createCapture('a baby memory');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('blocked_needs_auth');
      expect(result.error).toContain('not configured');
    });

    it('returns blocked_needs_auth when graph not in config', async () => {
      const storage = createMockStorage({
        graphs: [
          { graphName: 'other-graph', token: 'tok', addedAt: new Date().toISOString() },
        ],
      });
      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'daily_tagged', tag: '#memories' },
      });
      const capture = createCapture('a baby memory');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('blocked_needs_auth');
      expect(result.error).toContain('my-graph');
    });
  });

  describe('daily_tagged', () => {
    let storage: StorageInterface;

    beforeEach(() => {
      storage = createMockStorage({
        graphs: [
          { graphName: 'my-graph', token: 'test-token', addedAt: new Date().toISOString() },
        ],
      });
    });

    it('creates tag block and child when tag does not exist', async () => {
      // Mock the SDK functions used by RoamClient
      const { pull, createBlock } = await import('@roam-research/roam-api-sdk');
      const mockPull = vi.mocked(pull);
      const mockCreateBlock = vi.mocked(createBlock);

      // findBlockOnPage calls getPageByTitle (pull) - first call: tag not found
      // After creating tag block, retry finds it
      mockPull
        .mockResolvedValueOnce({
          ':node/title': 'March 14, 2026',
          ':block/uid': 'today-uid',
          ':block/children': [],
        } as any) // first findBlockOnPage - no matching tag
        .mockResolvedValueOnce({
          ':node/title': 'March 14, 2026',
          ':block/uid': 'today-uid',
          ':block/children': [
            { ':block/string': '#memories', ':block/uid': 'tag-uid', ':block/order': 0 },
          ],
        } as any); // retry findBlockOnPage - tag found

      mockCreateBlock
        .mockResolvedValueOnce(true as any) // create tag block
        .mockResolvedValueOnce(true as any); // create child block

      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'daily_tagged', tag: '#memories' },
      });
      const capture = createCapture('a baby memory');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');
      // Should have created a tag block first, then the child
      expect(mockCreateBlock).toHaveBeenCalledTimes(2);
    });

    it('appends to existing tag block', async () => {
      const { pull, createBlock } = await import('@roam-research/roam-api-sdk');
      const mockPull = vi.mocked(pull);
      const mockCreateBlock = vi.mocked(createBlock);

      // findBlockOnPage - tag exists
      mockPull.mockResolvedValueOnce({
        ':node/title': 'March 14, 2026',
        ':block/uid': 'today-uid',
        ':block/children': [
          { ':block/string': '#memories', ':block/uid': 'tag-uid', ':block/order': 0 },
        ],
      } as any);

      mockCreateBlock.mockResolvedValueOnce(true as any);

      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'daily_tagged', tag: '#memories' },
      });
      const capture = createCapture('another memory', 'another memory');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');
      // Should only create the child block (tag already exists)
      expect(mockCreateBlock).toHaveBeenCalledTimes(1);
    });

    it('prefixes tag with # if not already prefixed', async () => {
      const { pull, createBlock } = await import('@roam-research/roam-api-sdk');
      const mockPull = vi.mocked(pull);
      const mockCreateBlock = vi.mocked(createBlock);

      // findBlockOnPage - tag exists (with the # prefix)
      mockPull.mockResolvedValueOnce({
        ':node/title': 'March 14, 2026',
        ':block/uid': 'today-uid',
        ':block/children': [
          { ':block/string': '#memories', ':block/uid': 'tag-uid', ':block/order': 0 },
        ],
      } as any);

      mockCreateBlock.mockResolvedValueOnce(true as any);

      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'daily_tagged', tag: 'memories' }, // no prefix
      });
      const capture = createCapture('test');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');
      // Should have found the tag (meaning it searched for #memories, not memories)
      expect(mockCreateBlock).toHaveBeenCalledTimes(1); // only child, not tag creation
    });
  });

  describe('page_child', () => {
    let storage: StorageInterface;

    beforeEach(() => {
      storage = createMockStorage({
        graphs: [
          { graphName: 'my-graph', token: 'test-token', addedAt: new Date().toISOString() },
        ],
      });
    });

    it('creates page when it does not exist then appends block', async () => {
      const { pull, createPage, createBlock } = await import('@roam-research/roam-api-sdk');
      const mockPull = vi.mocked(pull);
      const mockCreatePage = vi.mocked(createPage);
      const mockCreateBlock = vi.mocked(createBlock);

      // First getPageByTitle - page doesn't exist
      mockPull
        .mockResolvedValueOnce(null as any)
        // After createPage, second getPageByTitle finds it
        .mockResolvedValueOnce({
          ':node/title': 'Baby Log',
          ':block/uid': 'page-uid-new',
          ':block/children': [],
        } as any);

      mockCreatePage.mockResolvedValueOnce(true as any);
      mockCreateBlock.mockResolvedValueOnce(true as any);

      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'page_child', pageTitle: 'Baby Log' },
      });
      const capture = createCapture('first smiled today');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');
      expect(mockCreatePage).toHaveBeenCalledTimes(1);
      expect(mockCreateBlock).toHaveBeenCalledTimes(1);
    });

    it('appends to existing page', async () => {
      const { pull, createPage, createBlock } = await import('@roam-research/roam-api-sdk');
      const mockPull = vi.mocked(pull);
      const mockCreatePage = vi.mocked(createPage);
      const mockCreateBlock = vi.mocked(createBlock);

      mockPull.mockResolvedValueOnce({
        ':node/title': 'Baby Log',
        ':block/uid': 'page-uid-123',
        ':block/children': [
          { ':block/string': 'existing entry', ':block/uid': 'e1', ':block/order': 0 },
        ],
      } as any);

      mockCreateBlock.mockResolvedValueOnce(true as any);

      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'page_child', pageTitle: 'Baby Log' },
      });
      const capture = createCapture('rolled over today');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');
      expect(mockCreatePage).not.toHaveBeenCalled();
      expect(mockCreateBlock).toHaveBeenCalledTimes(1);
    });

    it('uses parentBlockUid when specified', async () => {
      const { pull, createBlock } = await import('@roam-research/roam-api-sdk');
      const mockPull = vi.mocked(pull);
      const mockCreateBlock = vi.mocked(createBlock);

      mockPull.mockResolvedValueOnce({
        ':node/title': 'Baby Log',
        ':block/uid': 'page-uid-123',
        ':block/children': [],
      } as any);

      mockCreateBlock.mockResolvedValueOnce(true as any);

      const executor = new RoamExecutor(storage);
      const route = createRoute({
        graphName: 'my-graph',
        operation: { type: 'page_child', pageTitle: 'Baby Log', parentBlockUid: 'specific-block' },
      });
      const capture = createCapture('nested entry');

      const result = await executor.execute(route, capture);

      expect(result.status).toBe('success');
      expect(result.data).toEqual({
        pageTitle: 'Baby Log',
        parentUid: 'specific-block',
      });
    });
  });
});
