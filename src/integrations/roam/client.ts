// src/integrations/roam/client.ts
import { initializeGraph, q, pull, createBlock, createPage } from '@roam-research/roam-api-sdk';

// The SDK doesn't ship type declarations, so we type the graph handle loosely.
type RoamGraph = ReturnType<typeof initializeGraph>;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export class RoamClient {
  private graph: RoamGraph;

  constructor(graphName: string, token: string) {
    this.graph = initializeGraph({ graph: graphName, token });
  }

  /**
   * Get all page titles in the graph via Datalog query.
   */
  async getAllPageTitles(): Promise<string[]> {
    const results = await q(
      this.graph,
      '[:find ?title :where [?e :node/title ?title]]',
    );
    return (results as string[][]).map((row: string[]) => row[0]);
  }

  /**
   * Search pages by case-insensitive substring match.
   */
  async searchPages(query: string): Promise<string[]> {
    const allTitles = await this.getAllPageTitles();
    const lower = query.toLowerCase();
    return allTitles.filter((title: string) => title.toLowerCase().includes(lower));
  }

  /**
   * Get a page by its exact title, including children.
   * Returns the raw pull result or null if not found.
   */
  async getPageByTitle(title: string): Promise<Record<string, unknown> | null> {
    const result = await pull(
      this.graph,
      '[*]',
      `[:node/title "${title.replace(/"/g, '\\"')}"]`,
    );
    return result as Record<string, unknown> | null;
  }

  /**
   * Get children of a block by its UID.
   */
  async getBlockChildren(uid: string): Promise<Record<string, unknown>[]> {
    const result = await pull(
      this.graph,
      '[:block/children {:block/children [:block/string :block/uid :block/order]}]',
      `[:block/uid "${uid.replace(/"/g, '\\"')}"]`,
    );
    const data = result as Record<string, unknown> | null;
    return (data?.[':block/children'] as Record<string, unknown>[]) || [];
  }

  /**
   * Find a direct child block on a page by its text content.
   * Takes the page title (not UID) and searches direct children.
   */
  async findBlockOnPage(pageTitle: string, searchText: string): Promise<Record<string, unknown> | null> {
    const page = await this.getPageByTitle(pageTitle);
    if (!page) return null;
    const children = page[':block/children'] as Record<string, unknown>[] | undefined;
    if (!children) return null;
    const searchLower = searchText.toLowerCase();
    return children.find((child) => {
      const blockStr = child[':block/string'] as string | undefined;
      return blockStr?.toLowerCase().includes(searchLower);
    }) || null;
  }

  /**
   * Create a new page with the given title.
   */
  async createPage(title: string): Promise<boolean> {
    return createPage(this.graph, {
      action: 'create-page',
      page: { title },
    });
  }

  /**
   * Create a block under a parent UID.
   * @param parentUid - The UID of the parent block or page
   * @param text - Block content string
   * @param order - Position ('last' by default, or a number)
   */
  async createBlock(parentUid: string, text: string, order?: number): Promise<boolean> {
    return createBlock(this.graph, {
      action: 'create-block',
      location: { 'parent-uid': parentUid, order: order ?? 'last' },
      block: { string: text },
    });
  }

  // ── Static date helpers ──────────────────────────────────────────

  /**
   * Get today's daily page title in Roam format: "March 14, 2026"
   */
  static todayPageTitle(): string {
    return RoamClient.datePageTitle(new Date());
  }

  /**
   * Get today's daily page UID in Roam format: "03-14-2026"
   */
  static todayPageUid(): string {
    return RoamClient.datePageUid(new Date());
  }

  /**
   * Format a date as a Roam daily page title: "March 14, 2026"
   */
  static datePageTitle(date: Date): string {
    const month = MONTHS[date.getUTCMonth()];
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();
    return `${month} ${day}, ${year}`;
  }

  /**
   * Format a date as a Roam daily page UID: "03-14-2026"
   */
  static datePageUid(date: Date): string {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${month}-${day}-${year}`;
  }
}
