// tests/integrations/roam-toolkit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isDatePageTitle, listPages, inspectPage } from '../../src/integrations/roam/toolkit';
import type { RoamClient } from '../../src/integrations/roam/client';

function createMockClient(overrides: Partial<RoamClient> = {}): RoamClient {
  return {
    getAllPageTitles: vi.fn().mockResolvedValue([]),
    getPageByTitle: vi.fn().mockResolvedValue(null),
    searchPages: vi.fn().mockResolvedValue([]),
    getBlockChildren: vi.fn().mockResolvedValue([]),
    findBlockOnPage: vi.fn().mockResolvedValue(null),
    createPage: vi.fn().mockResolvedValue(true),
    createBlock: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as RoamClient;
}

describe('isDatePageTitle', () => {
  it('matches standard date format', () => {
    expect(isDatePageTitle('March 14, 2026')).toBe(true);
    expect(isDatePageTitle('January 1, 2025')).toBe(true);
    expect(isDatePageTitle('December 31, 2024')).toBe(true);
  });

  it('matches ordinal date format', () => {
    expect(isDatePageTitle('January 1st, 2025')).toBe(true);
    expect(isDatePageTitle('March 2nd, 2026')).toBe(true);
    expect(isDatePageTitle('April 3rd, 2026')).toBe(true);
    expect(isDatePageTitle('May 4th, 2026')).toBe(true);
  });

  it('rejects non-date strings', () => {
    expect(isDatePageTitle('Baby Memories')).toBe(false);
    expect(isDatePageTitle('Project Notes')).toBe(false);
    expect(isDatePageTitle('2026-03-14')).toBe(false);
    expect(isDatePageTitle('March 2026')).toBe(false);
    expect(isDatePageTitle('14 March, 2026')).toBe(false);
    expect(isDatePageTitle('')).toBe(false);
  });
});

describe('listPages', () => {
  it('returns non-date pages sorted alphabetically', async () => {
    const client = createMockClient({
      getAllPageTitles: vi.fn().mockResolvedValue([
        'Zebra Notes',
        'March 14, 2026',
        'Baby Memories',
        'January 1st, 2025',
        'Apple Tracker',
      ]),
    });

    const pages = await listPages(client);
    expect(pages).toEqual(['Apple Tracker', 'Baby Memories', 'Zebra Notes']);
  });

  it('filters out all date pages', async () => {
    const client = createMockClient({
      getAllPageTitles: vi.fn().mockResolvedValue([
        'March 14, 2026',
        'January 1st, 2025',
        'December 31, 2024',
      ]),
    });

    const pages = await listPages(client);
    expect(pages).toEqual([]);
  });

  it('caps results at 500', async () => {
    const titles = Array.from({ length: 600 }, (_, i) => `Page ${String(i).padStart(3, '0')}`);
    const client = createMockClient({
      getAllPageTitles: vi.fn().mockResolvedValue(titles),
    });

    const pages = await listPages(client);
    expect(pages).toHaveLength(500);
  });
});

describe('inspectPage', () => {
  it('returns page with children', async () => {
    const pageData = {
      ':node/title': 'Test Page',
      ':block/uid': 'page-uid-123',
      ':block/children': [
        { ':block/string': 'child 1', ':block/uid': 'c1', ':block/order': 0 },
        { ':block/string': 'child 2', ':block/uid': 'c2', ':block/order': 1 },
      ],
    };
    const client = createMockClient({
      getPageByTitle: vi.fn().mockResolvedValue(pageData),
    });

    const result = await inspectPage(client, 'Test Page');

    expect(result).toEqual({
      title: 'Test Page',
      uid: 'page-uid-123',
      children: [
        { string: 'child 1', uid: 'c1', order: 0 },
        { string: 'child 2', uid: 'c2', order: 1 },
      ],
    });
  });

  it('returns null when page not found', async () => {
    const client = createMockClient({
      getPageByTitle: vi.fn().mockResolvedValue(null),
    });

    const result = await inspectPage(client, 'Nonexistent');
    expect(result).toBeNull();
  });

  it('returns empty children array when page has no children', async () => {
    const pageData = {
      ':node/title': 'Empty Page',
      ':block/uid': 'empty-uid',
    };
    const client = createMockClient({
      getPageByTitle: vi.fn().mockResolvedValue(pageData),
    });

    const result = await inspectPage(client, 'Empty Page');
    expect(result).toEqual({
      title: 'Empty Page',
      uid: 'empty-uid',
      children: [],
    });
  });
});
