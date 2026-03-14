// tests/integrations/roam-live.test.ts
// Live integration tests that hit the real Roam API.
// Skipped if ROAM_TEST_GRAPH_NAME / ROAM_TEST_GRAPH_TOKEN are not set.

import dotenv from 'dotenv';
dotenv.config();

import { describe, it, expect } from 'vitest';
import { RoamClient } from '../../src/integrations/roam/client';
import { listPages } from '../../src/integrations/roam/toolkit';

const graphName = process.env.ROAM_TEST_GRAPH_NAME;
const token = process.env.ROAM_TEST_GRAPH_TOKEN;
const itLive = graphName && token ? it : it.skip;

describe('Roam Live Integration', () => {
  let client: RoamClient;

  if (graphName && token) {
    client = new RoamClient(graphName, token);
  }

  itLive('can list page titles', async () => {
    const titles = await client.getAllPageTitles();
    expect(Array.isArray(titles)).toBe(true);
    expect(titles.length).toBeGreaterThan(0);
    // Every title should be a string
    for (const t of titles) {
      expect(typeof t).toBe('string');
    }
  });

  itLive('can search pages', async () => {
    const results = await client.searchPages('movie');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    // All results should contain 'movie' (case-insensitive)
    for (const r of results) {
      expect(r.toLowerCase()).toContain('movie');
    }
  });

  itLive('can get page by title', async () => {
    const page = await client.getPageByTitle('movie recs');
    expect(page).not.toBeNull();
    expect(page![':node/title']).toBe('movie recs');
    expect(page![':block/uid']).toBeDefined();
  });

  itLive('returns null for nonexistent page', async () => {
    const page = await client.getPageByTitle('this-page-definitely-does-not-exist-xyz-123');
    expect(page).toBeNull();
  });

  itLive('listPages from toolkit filters date pages', async () => {
    const pages = await listPages(client);
    expect(Array.isArray(pages)).toBe(true);
    expect(pages.length).toBeGreaterThan(0);
    // No date-formatted pages should appear
    const dateRe = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?,\s+\d{4}$/;
    for (const p of pages) {
      expect(dateRe.test(p)).toBe(false);
    }
    // Should include our seeded pages
    expect(pages).toContain('movie recs');
    expect(pages).toContain('bodylog');
  });

  itLive('can create and find a block', async () => {
    const uniqueText = `live-test-block-${Date.now()}`;
    const todayTitle = RoamClient.todayPageTitle();

    // Ensure today's page exists
    try {
      await client.createPage(todayTitle);
    } catch {
      // may already exist
    }

    // Get the page UID so we can create a block
    const page = await client.getPageByTitle(todayTitle);
    expect(page).not.toBeNull();
    const pageUid = page![':block/uid'] as string;

    // Create the block
    await client.createBlock(pageUid, uniqueText);

    // Give Roam time to index the new block
    await new Promise((r) => setTimeout(r, 3000));

    // Find it via getBlockChildren (more reliable than findBlockOnPage for fresh blocks)
    const children = await client.getBlockChildren(pageUid);
    const found = children.find((c) => (c as Record<string, unknown>)[':block/string'] === uniqueText);
    expect(found).toBeDefined();
    expect((found as Record<string, unknown>)[':block/string']).toBe(uniqueText);
  }, 20_000);

  itLive('todayPageUid format matches MM-DD-YYYY', () => {
    const uid = RoamClient.todayPageUid();
    expect(uid).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });
});
