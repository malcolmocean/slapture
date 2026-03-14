// src/integrations/roam/toolkit.ts
import type { RoamClient } from './client.js';

const DATE_PAGE_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?,\s+\d{4}$/;

/**
 * Returns true if the title matches a Roam daily page format like "March 14, 2026".
 */
export function isDatePageTitle(title: string): boolean {
  return DATE_PAGE_RE.test(title);
}

/**
 * List all non-date pages in the graph, sorted alphabetically, capped at 500.
 */
export async function listPages(client: RoamClient): Promise<string[]> {
  const allTitles = await client.getAllPageTitles();
  return allTitles
    .filter((title) => !isDatePageTitle(title))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 500);
}

export interface InspectPageResult {
  title: string;
  uid: string;
  children: { string: string; uid: string; order: number }[];
}

/**
 * Inspect a page by title, returning its UID and top-level children.
 */
export async function inspectPage(client: RoamClient, title: string): Promise<InspectPageResult | null> {
  const page = await client.getPageByTitle(title);
  if (!page) return null;

  const rawChildren = (page[':block/children'] as Record<string, unknown>[] | undefined) || [];

  return {
    title: page[':node/title'] as string,
    uid: page[':block/uid'] as string,
    children: rawChildren.map((child) => ({
      string: child[':block/string'] as string,
      uid: child[':block/uid'] as string,
      order: child[':block/order'] as number,
    })),
  };
}
