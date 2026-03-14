// tests/integrations/roam-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK before importing client
vi.mock('@roam-research/roam-api-sdk', () => ({
  initializeGraph: vi.fn(),
  q: vi.fn(),
  pull: vi.fn(),
  createBlock: vi.fn(),
  createPage: vi.fn(),
}));

import { RoamClient } from '../../src/integrations/roam/client';
import { initializeGraph, q, pull, createBlock, createPage } from '@roam-research/roam-api-sdk';

const mockInitializeGraph = vi.mocked(initializeGraph);
const mockQ = vi.mocked(q);
const mockPull = vi.mocked(pull);
const mockCreateBlock = vi.mocked(createBlock);
const mockCreatePage = vi.mocked(createPage);

describe('RoamClient', () => {
  let client: RoamClient;
  const mockGraph = { graph: 'test-graph', token: 'test-token' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeGraph.mockReturnValue(mockGraph as any);
    client = new RoamClient('test-graph', 'test-token');
  });

  it('initializes graph on construction', () => {
    expect(mockInitializeGraph).toHaveBeenCalledWith({
      graph: 'test-graph',
      token: 'test-token',
    });
  });

  describe('getAllPageTitles', () => {
    it('returns page titles from datalog query', async () => {
      mockQ.mockResolvedValue([
        ['Page One'],
        ['Page Two'],
        ['Daily Notes'],
      ] as any);

      const titles = await client.getAllPageTitles();

      expect(mockQ).toHaveBeenCalledWith(
        mockGraph,
        '[:find ?title :where [?e :node/title ?title]]',
      );
      expect(titles).toEqual(['Page One', 'Page Two', 'Daily Notes']);
    });

    it('returns empty array when no pages', async () => {
      mockQ.mockResolvedValue([] as any);
      const titles = await client.getAllPageTitles();
      expect(titles).toEqual([]);
    });
  });

  describe('searchPages', () => {
    it('filters pages by case-insensitive substring', async () => {
      mockQ.mockResolvedValue([
        ['Baby Memories'],
        ['Work Notes'],
        ['Baby Names'],
      ] as any);

      const results = await client.searchPages('baby');
      expect(results).toEqual(['Baby Memories', 'Baby Names']);
    });

    it('returns empty array when no match', async () => {
      mockQ.mockResolvedValue([
        ['Work Notes'],
      ] as any);

      const results = await client.searchPages('baby');
      expect(results).toEqual([]);
    });
  });

  describe('getPageByTitle', () => {
    it('returns page data with children', async () => {
      const pageData = {
        ':node/title': 'Test Page',
        ':block/uid': 'page-uid-123',
        ':block/children': [
          { ':block/string': 'child 1', ':block/uid': 'c1', ':block/order': 0 },
          { ':block/string': 'child 2', ':block/uid': 'c2', ':block/order': 1 },
        ],
      };
      mockPull.mockResolvedValue(pageData as any);

      const result = await client.getPageByTitle('Test Page');

      expect(mockPull).toHaveBeenCalledWith(
        mockGraph,
        '[*]',
        '[:node/title "Test Page"]',
      );
      expect(result).toEqual(pageData);
    });

    it('returns null when page not found', async () => {
      mockPull.mockResolvedValue(null as any);
      const result = await client.getPageByTitle('Nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getBlockChildren', () => {
    it('returns children of a block', async () => {
      const blockData = {
        ':block/children': [
          { ':block/string': 'child 1', ':block/uid': 'c1', ':block/order': 0 },
          { ':block/string': 'child 2', ':block/uid': 'c2', ':block/order': 1 },
        ],
      };
      mockPull.mockResolvedValue(blockData as any);

      const result = await client.getBlockChildren('parent-uid');

      expect(mockPull).toHaveBeenCalledWith(
        mockGraph,
        '[:block/children {:block/children [:block/string :block/uid :block/order]}]',
        '[:block/uid "parent-uid"]',
      );
      expect(result).toEqual(blockData[':block/children']);
    });

    it('returns empty array when no children', async () => {
      mockPull.mockResolvedValue({} as any);
      const result = await client.getBlockChildren('parent-uid');
      expect(result).toEqual([]);
    });
  });

  describe('findBlockOnPage', () => {
    it('finds a direct child block by text', async () => {
      // First call: getPageByTitle (pull)
      const pageData = {
        ':node/title': 'Daily Page',
        ':block/uid': 'page-uid',
        ':block/children': [
          { ':block/string': '[[Project A]]', ':block/uid': 'b1', ':block/order': 0 },
          { ':block/string': '[[Memories]]', ':block/uid': 'b2', ':block/order': 1 },
        ],
      };
      mockPull.mockResolvedValue(pageData as any);

      const result = await client.findBlockOnPage('Daily Page', '[[Memories]]');

      expect(result).toEqual({ ':block/string': '[[Memories]]', ':block/uid': 'b2', ':block/order': 1 });
    });

    it('returns null when block not found', async () => {
      const pageData = {
        ':node/title': 'Daily Page',
        ':block/uid': 'page-uid',
        ':block/children': [
          { ':block/string': '[[Project A]]', ':block/uid': 'b1', ':block/order': 0 },
        ],
      };
      mockPull.mockResolvedValue(pageData as any);

      const result = await client.findBlockOnPage('Daily Page', '[[Memories]]');
      expect(result).toBeNull();
    });

    it('returns null when page has no children', async () => {
      mockPull.mockResolvedValue({ ':node/title': 'Empty Page' } as any);
      const result = await client.findBlockOnPage('Empty Page', 'anything');
      expect(result).toBeNull();
    });

    it('returns null when page not found', async () => {
      mockPull.mockResolvedValue(null as any);
      const result = await client.findBlockOnPage('Nonexistent', 'anything');
      expect(result).toBeNull();
    });
  });

  describe('createPage', () => {
    it('creates a page with given title', async () => {
      mockCreatePage.mockResolvedValue(true as any);

      const result = await client.createPage('New Page');

      expect(mockCreatePage).toHaveBeenCalledWith(mockGraph, {
        action: 'create-page',
        page: { title: 'New Page' },
      });
      expect(result).toBe(true);
    });
  });

  describe('createBlock', () => {
    it('creates a block under parent with default order', async () => {
      mockCreateBlock.mockResolvedValue(true as any);

      const result = await client.createBlock('parent-uid', 'Hello world');

      expect(mockCreateBlock).toHaveBeenCalledWith(mockGraph, {
        action: 'create-block',
        location: { 'parent-uid': 'parent-uid', order: 'last' },
        block: { string: 'Hello world' },
      });
      expect(result).toBe(true);
    });

    it('creates a block with specific order', async () => {
      mockCreateBlock.mockResolvedValue(true as any);

      const result = await client.createBlock('parent-uid', 'First block', 0);

      expect(mockCreateBlock).toHaveBeenCalledWith(mockGraph, {
        action: 'create-block',
        location: { 'parent-uid': 'parent-uid', order: 0 },
        block: { string: 'First block' },
      });
      expect(result).toBe(true);
    });
  });

  describe('static date helpers', () => {
    it('todayPageTitle returns today formatted', () => {
      const title = RoamClient.todayPageTitle();
      // Should be in format "Month Day, Year"
      expect(title).toMatch(/^\w+ \d{1,2}, \d{4}$/);
    });

    it('todayPageUid returns today formatted as MM-DD-YYYY', () => {
      const uid = RoamClient.todayPageUid();
      expect(uid).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    });

    it('datePageTitle formats a specific date', () => {
      const date = new Date('2026-03-14T00:00:00Z');
      const title = RoamClient.datePageTitle(date);
      expect(title).toBe('March 14, 2026');
    });

    it('datePageUid formats a specific date as MM-DD-YYYY', () => {
      const date = new Date('2026-03-14T00:00:00Z');
      const uid = RoamClient.datePageUid(date);
      expect(uid).toBe('03-14-2026');
    });

    it('datePageTitle handles single-digit days', () => {
      const date = new Date('2026-01-05T00:00:00Z');
      const title = RoamClient.datePageTitle(date);
      expect(title).toBe('January 5, 2026');
    });

    it('datePageUid pads single-digit months and days', () => {
      const date = new Date('2026-01-05T00:00:00Z');
      const uid = RoamClient.datePageUid(date);
      expect(uid).toBe('01-05-2026');
    });
  });
});
