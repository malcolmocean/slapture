# Roam Research Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Roam Research as a destination type so captures can be routed to Roam graphs.

**Architecture:** Thin client wrapping `@roam-research/roam-api-sdk`, two executor modes (daily_tagged, page_child), token storage following existing Sheets/Intend pattern, Mastermind context injection of page lists per connected graph.

**Tech Stack:** TypeScript, `@roam-research/roam-api-sdk`, Vitest, Playwright, Hono

**Spec:** `docs/superpowers/specs/2026-03-14-roam-integration-design.md`

---

## File Map

**Create:**
- `src/integrations/roam/types.ts` — Block, RoamDestinationConfig, RoamOperation types
- `src/integrations/roam/client.ts` — RoamClient wrapping roam-api-sdk
- `src/integrations/roam/toolkit.ts` — listPages, inspectPage
- `src/integrations/roam/index.ts` — re-exports
- `src/routes/roam-executor.ts` — RoamExecutor (daily_tagged + page_child)
- `src/server/roam.ts` — POST/DELETE endpoints for graph connection
- `tests/integrations/roam-client.test.ts` — RoamClient unit tests (mocked SDK)
- `tests/integrations/roam-toolkit.test.ts` — toolkit unit tests
- `tests/integrations/roam-live.test.ts` — live integration tests against test graph
- `tests/routes/roam-executor.test.ts` — RoamExecutor unit tests
- `tests/e2e/roam-routing.spec.ts` — Playwright E2E tests
- `tmp/seed-roam-graph.ts` — script to populate test graph with realistic data

**Modify:**
- `package.json` — add `@roam-research/roam-api-sdk` dependency
- `src/types.ts` — add RoamConfig, RoamGraphConfig, update IntegrationConfig, update Route destinationType/destinationConfig unions
- `src/storage/interface.ts` — add getRoamConfig/saveRoamConfig/clearRoamConfig
- `src/storage/index.ts` — implement Roam storage methods (local)
- `src/storage/firestore.ts` — implement Roam storage methods (Firestore)
- `src/integrations/registry.ts` — add Roam to INTEGRATIONS array and getIntegrationsWithStatus
- `src/routes/executor.ts` — add RoamExecutor dispatch branch
- `src/pipeline/index.ts` — add Roam context gathering in gatherIntegrationContext
- `src/mastermind/index.ts` — add RoamContextEntry type, buildIntegrationSection Roam block, buildPrompt Roam destination docs
- `src/server/index.ts` — import and wire up Roam routes
- `src/dashboard/routes.ts` — add Roam-specific UI in auth page (add graph form, remove button)

---

## Chunk 1: Foundation — Types, SDK, Client, Storage

### Task 1: Install SDK and add types

**Files:**
- Modify: `package.json`
- Modify: `src/types.ts`
- Create: `src/integrations/roam/types.ts`

- [ ] **Step 1: Install roam-api-sdk**

```bash
pnpm add @roam-research/roam-api-sdk
```

- [ ] **Step 2: Add Roam types to src/integrations/roam/types.ts**

```ts
// src/integrations/roam/types.ts

export interface Block {
  uid: string;
  string: string;
  order: number;
  children?: Block[];
}

export interface RoamDestinationConfig {
  graphName: string;
  operation: RoamOperation;
}

export type RoamOperation = DailyTaggedOperation | PageChildOperation;

export interface DailyTaggedOperation {
  type: 'daily_tagged';
  tag: string;
}

export interface PageChildOperation {
  type: 'page_child';
  pageTitle: string;
  parentBlockUid?: string;
}
```

- [ ] **Step 3: Add RoamConfig types and update unions in src/types.ts**

Add after `SheetsTokens`:
```ts
export interface RoamGraphConfig {
  graphName: string;
  token: string;
  addedAt: string;  // ISO 8601
}

export interface RoamConfig {
  graphs: RoamGraphConfig[];
}
```

Update `IntegrationConfig`:
```ts
export interface IntegrationConfig {
  intend?: IntendTokens;
  sheets?: SheetsTokens;
  roam?: RoamConfig;
}
```

Update `Route.destinationType` to: `'fs' | 'intend' | 'notes' | 'sheets' | 'roam'`

Update `Route.destinationConfig` union to include `| RoamDestinationConfig` (import from `./integrations/roam/types.js`). Note: use a forward-declared interface in types.ts like the existing `SheetsDestinationConfig` pattern to avoid circular imports:
```ts
export interface RoamDestinationConfig {
  graphName: string;
  operation: unknown;  // Full type: RoamOperation from integrations/roam/types.ts
}
```

**Note on dual `RoamDestinationConfig`:** The forward declaration in `src/types.ts` (with `operation: unknown`) avoids circular imports. The full type in `src/integrations/roam/types.ts` has the real `RoamOperation` type. Code that needs the full type (like the executor) should import from `roam/types.ts` and cast `route.destinationConfig as RoamDestinationConfig`.

- [ ] **Step 4: Build to verify types compile**

```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/types.ts src/integrations/roam/types.ts && git commit -m "feat: add Roam types and install roam-api-sdk"
```

### Task 2: RoamClient

**Files:**
- Create: `src/integrations/roam/client.ts`
- Create: `src/integrations/roam/index.ts`
- Create: `tests/integrations/roam-client.test.ts`

- [ ] **Step 1: Write failing tests for RoamClient**

Create `tests/integrations/roam-client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoamClient } from '../../src/integrations/roam/client';

// Mock the SDK
vi.mock('@roam-research/roam-api-sdk', () => ({
  initializeGraph: vi.fn(() => ({ graph: 'test-graph', token: 'test-token' })),
  q: vi.fn(),
  pull: vi.fn(),
  createBlock: vi.fn(),
  createPage: vi.fn(),
}));

import { q, pull, createBlock, createPage } from '@roam-research/roam-api-sdk';
const mockQ = vi.mocked(q);
const mockPull = vi.mocked(pull);
const mockCreateBlock = vi.mocked(createBlock);
const mockCreatePage = vi.mocked(createPage);

describe('RoamClient', () => {
  let client: RoamClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new RoamClient('test-graph', 'roam-graph-token-test');
  });

  describe('static date helpers', () => {
    it('generates correct daily page title', () => {
      const title = RoamClient.datePageTitle(new Date('2026-03-14'));
      expect(title).toBe('March 14, 2026');
    });

    it('generates correct daily page UID', () => {
      const uid = RoamClient.datePageUid(new Date('2026-03-14'));
      expect(uid).toBe('03-14-2026');
    });

    it('generates today helpers without error', () => {
      expect(RoamClient.todayPageTitle()).toBeTruthy();
      expect(RoamClient.todayPageUid()).toBeTruthy();
    });
  });

  describe('getAllPageTitles', () => {
    it('returns page titles from query results', async () => {
      mockQ.mockResolvedValue([
        ['My Page', 'abc123'],
        ['Another Page', 'def456'],
      ]);
      const pages = await client.getAllPageTitles();
      expect(pages).toEqual([
        { title: 'My Page', uid: 'abc123' },
        { title: 'Another Page', uid: 'def456' },
      ]);
      expect(mockQ).toHaveBeenCalledOnce();
    });
  });

  describe('searchPages', () => {
    it('returns matching pages', async () => {
      mockQ.mockResolvedValue([['Movie Recs', 'mov123']]);
      const pages = await client.searchPages('Movie');
      expect(pages).toEqual([{ title: 'Movie Recs', uid: 'mov123' }]);
    });
  });

  describe('getPageByTitle', () => {
    it('returns page with children', async () => {
      mockPull.mockResolvedValue({
        ':block/uid': 'page1',
        ':block/children': [
          { ':block/uid': 'c1', ':block/string': 'child 1', ':block/order': 0 },
          { ':block/uid': 'c2', ':block/string': 'child 2', ':block/order': 1 },
        ],
      });
      const page = await client.getPageByTitle('Test Page');
      expect(page).toEqual({
        uid: 'page1',
        children: [
          { uid: 'c1', string: 'child 1', order: 0 },
          { uid: 'c2', string: 'child 2', order: 1 },
        ],
      });
    });

    it('returns null for non-existent page', async () => {
      mockPull.mockResolvedValue(null);
      const page = await client.getPageByTitle('Nonexistent');
      expect(page).toBeNull();
    });
  });

  describe('findBlockOnPage', () => {
    it('finds matching block among direct children', async () => {
      mockQ.mockResolvedValue([['block1', '#movie-recs']]);
      const block = await client.findBlockOnPage('page-uid', 'movie-recs');
      expect(block).toEqual({ uid: 'block1', string: '#movie-recs' });
    });

    it('returns null when no match', async () => {
      mockQ.mockResolvedValue([]);
      const block = await client.findBlockOnPage('page-uid', 'nonexistent');
      expect(block).toBeNull();
    });
  });

  describe('getBlockChildren', () => {
    it('returns sorted children', async () => {
      mockPull.mockResolvedValue({
        ':block/children': [
          { ':block/uid': 'c2', ':block/string': 'second', ':block/order': 1 },
          { ':block/uid': 'c1', ':block/string': 'first', ':block/order': 0 },
        ],
      });
      const children = await client.getBlockChildren('parent-uid');
      expect(children).toEqual([
        { uid: 'c1', string: 'first', order: 0 },
        { uid: 'c2', string: 'second', order: 1 },
      ]);
    });

    it('returns empty array for block with no children', async () => {
      mockPull.mockResolvedValue(null);
      const children = await client.getBlockChildren('empty-uid');
      expect(children).toEqual([]);
    });
  });

  describe('createPage', () => {
    it('calls SDK createPage', async () => {
      mockCreatePage.mockResolvedValue(true);
      const result = await client.createPage('New Page');
      expect(result).toBe(true);
    });
  });

  describe('createBlock', () => {
    it('calls SDK createBlock with correct args', async () => {
      mockCreateBlock.mockResolvedValue(true);
      const result = await client.createBlock('parent-uid', 'block text');
      expect(result).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/integrations/roam-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement RoamClient**

Create `src/integrations/roam/client.ts`:
```ts
import { initializeGraph, q, pull, createBlock as sdkCreateBlock, createPage as sdkCreatePage } from '@roam-research/roam-api-sdk';
import type { Block } from './types.js';

export class RoamClient {
  private graph: ReturnType<typeof initializeGraph>;

  constructor(graphName: string, token: string) {
    this.graph = initializeGraph({ graph: graphName, token });
  }

  // --- Query methods ---

  async getAllPageTitles(): Promise<{ title: string; uid: string }[]> {
    const results = await q(
      this.graph,
      '[:find ?title ?uid :where [?p :node/title ?title] [?p :block/uid ?uid]]'
    );
    return (results as [string, string][]).map(([title, uid]) => ({ title, uid }));
  }

  async searchPages(query: string): Promise<{ title: string; uid: string }[]> {
    const results = await q(
      this.graph,
      '[:find ?title ?uid :in $ ?search :where [?p :node/title ?title] [?p :block/uid ?uid] [(clojure.string/includes? ?title ?search)]]',
      [query]
    );
    return (results as [string, string][]).map(([title, uid]) => ({ title, uid }));
  }

  async getPageByTitle(title: string): Promise<{ uid: string; children: Block[] } | null> {
    const result = await pull(
      this.graph,
      '[:block/uid {:block/children [:block/uid :block/string :block/order]}]',
      `[:node/title "${title}"]`
    );
    if (!result || !result[':block/uid']) return null;

    const children = (result[':block/children'] || []).map((c: Record<string, unknown>) => ({
      uid: c[':block/uid'] as string,
      string: c[':block/string'] as string,
      order: c[':block/order'] as number,
    }));
    children.sort((a: Block, b: Block) => a.order - b.order);

    return { uid: result[':block/uid'] as string, children };
  }

  async getBlockChildren(uid: string): Promise<Block[]> {
    const result = await pull(
      this.graph,
      '[{:block/children [:block/uid :block/string :block/order]}]',
      `[:block/uid "${uid}"]`
    );
    if (!result || !result[':block/children']) return [];

    return (result[':block/children'] as Record<string, unknown>[])
      .map(c => ({
        uid: c[':block/uid'] as string,
        string: c[':block/string'] as string,
        order: c[':block/order'] as number,
      }))
      .sort((a, b) => a.order - b.order);
  }

  async findBlockOnPage(
    pageTitle: string,
    searchText: string
  ): Promise<{ uid: string; string: string } | null> {
    const results = await q(
      this.graph,
      '[:find ?uid ?str :in $ ?page-title ?search :where [?p :node/title ?page-title] [?p :block/children ?b] [?b :block/uid ?uid] [?b :block/string ?str] [(clojure.string/includes? ?str ?search)]]',
      [pageTitle, searchText]
    );
    const rows = results as [string, string][];
    if (rows.length === 0) return null;
    return { uid: rows[0][0], string: rows[0][1] };
  }

  // --- Write methods ---

  async createPage(title: string): Promise<boolean> {
    return sdkCreatePage(this.graph, {
      action: 'create-page',
      page: { title },
    });
  }

  async createBlock(
    parentUid: string,
    text: string,
    order: 'last' | number = 'last'
  ): Promise<boolean> {
    return sdkCreateBlock(this.graph, {
      action: 'create-block',
      location: { 'parent-uid': parentUid, order },
      block: { string: text },
    });
  }

  // --- Static date helpers ---

  static todayPageTitle(): string {
    return RoamClient.datePageTitle(new Date());
  }

  static todayPageUid(): string {
    return RoamClient.datePageUid(new Date());
  }

  static datePageTitle(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  static datePageUid(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
  }
}
```

Note: The `findBlockOnPage` method takes a page **title** (not UID) because the Datalog query needs `:node/title` for pages. The spec originally said `pageUid` but the query uses `:node/title`. Update the test accordingly if needed.

Create `src/integrations/roam/index.ts`:
```ts
export { RoamClient } from './client.js';
export * from './types.js';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- tests/integrations/roam-client.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/roam/ tests/integrations/roam-client.test.ts && git commit -m "feat: add RoamClient wrapping roam-api-sdk"
```

### Task 3: Storage — interface + both implementations

**Files:**
- Modify: `src/storage/interface.ts`
- Modify: `src/storage/index.ts`
- Modify: `src/storage/firestore.ts`

- [ ] **Step 1: Add methods to StorageInterface**

In `src/storage/interface.ts`, add after the `clearSheetsTokens` line:
```ts
  // Roam graph tokens
  getRoamConfig(username: string): Promise<RoamConfig | null>;
  saveRoamConfig(username: string, config: RoamConfig): Promise<void>;
  clearRoamConfig(username: string): Promise<void>;
```

Update the import line to include `RoamConfig`:
```ts
import type { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, SheetsTokens, RoamConfig, TriggerChangeReview, UserProfile, ApiKey } from '../types.js';
```

- [ ] **Step 2: Implement in local Storage (src/storage/index.ts)**

First, add `RoamConfig` to imports at the top of the file:
```ts
import { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, SheetsTokens, RoamConfig, TriggerChangeReview, UserProfile, ApiKey } from '../types.js';
```

Update both `getUserConfig` and `saveUserConfig` type annotations. The inline type currently has `{ integrations?: { intend?: IntendTokens; sheets?: SheetsTokens } }`. Change to:
```ts
{ integrations?: { intend?: IntendTokens; sheets?: SheetsTokens; roam?: RoamConfig } }
```

Then add after `clearSheetsTokens`:
```ts
  async getRoamConfig(username: string): Promise<RoamConfig | null> {
    const config = await this.getUserConfig(username);
    return config.integrations?.roam || null;
  }

  async saveRoamConfig(username: string, roamConfig: RoamConfig): Promise<void> {
    const config = await this.getUserConfig(username);
    config.integrations = config.integrations || {};
    config.integrations.roam = roamConfig;
    await this.saveUserConfig(username, config);
  }

  async clearRoamConfig(username: string): Promise<void> {
    const config = await this.getUserConfig(username);
    if (config.integrations) {
      delete config.integrations.roam;
      await this.saveUserConfig(username, config);
    }
  }
```

- [ ] **Step 3: Implement in FirestoreStorage (src/storage/firestore.ts)**

Add `RoamConfig` to imports:
```ts
import type { Capture, Route, Config, ExecutionStep, EvolverTestCase, IntendTokens, SheetsTokens, RoamConfig, TriggerChangeReview, UserProfile, ApiKey } from '../types.js';
```

Add after `clearSheetsTokens`:
```ts
  async getRoamConfig(username: string): Promise<RoamConfig | null> {
    const doc = await this.db.collection('users').doc(username).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return data?.integrations?.roam || null;
  }

  async saveRoamConfig(username: string, roamConfig: RoamConfig): Promise<void> {
    await this.db.collection('users').doc(username).set(
      { integrations: { roam: roamConfig } },
      { merge: true }
    );
  }

  async clearRoamConfig(username: string): Promise<void> {
    const { FieldValue } = await import('@google-cloud/firestore');
    await this.db.collection('users').doc(username).update({
      'integrations.roam': FieldValue.delete(),
    });
  }
```

- [ ] **Step 4: Build to verify**

```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add src/storage/ && git commit -m "feat: add Roam storage methods to interface and both backends"
```

### Task 4: Registry + integration status

**Files:**
- Modify: `src/integrations/registry.ts`

- [ ] **Step 1: Add Roam to INTEGRATIONS array**

In `src/integrations/registry.ts`, add to the `INTEGRATIONS` array:
```ts
  {
    id: 'roam',
    name: 'Roam Research',
    purpose: 'Create blocks and pages in Roam graphs — daily pages, tagged entries, structured notes',
    authType: 'api-key',
  },
```

- [ ] **Step 2: Add status check in getIntegrationsWithStatus**

In the `for (const integration of INTEGRATIONS)` loop, add before the `else` default:
```ts
    } else if (integration.id === 'roam') {
      const roamConfig = await storage.getRoamConfig(username);
      status = roamConfig?.graphs?.length ? 'connected' : 'never';
```

- [ ] **Step 3: Build to verify**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/integrations/registry.ts && git commit -m "feat: add Roam to integration registry"
```

---

## Chunk 2: Executor + Pipeline Integration

### Task 5: Toolkit (listPages, inspectPage)

**Files:**
- Create: `src/integrations/roam/toolkit.ts`
- Create: `tests/integrations/roam-toolkit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integrations/roam-toolkit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listPages, inspectPage, isDatePageTitle } from '../../src/integrations/roam/toolkit';
import { RoamClient } from '../../src/integrations/roam/client';

vi.mock('../../src/integrations/roam/client');

describe('roam toolkit', () => {
  let mockClient: RoamClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      getAllPageTitles: vi.fn(),
      getPageByTitle: vi.fn(),
    } as unknown as RoamClient;
  });

  describe('isDatePageTitle', () => {
    it('matches standard Roam date pages', () => {
      expect(isDatePageTitle('March 14, 2026')).toBe(true);
      expect(isDatePageTitle('January 1, 2025')).toBe(true);
      expect(isDatePageTitle('December 31, 2024')).toBe(true);
    });

    it('matches ordinal date pages', () => {
      expect(isDatePageTitle('March 14th, 2026')).toBe(true);
      expect(isDatePageTitle('January 1st, 2025')).toBe(true);
      expect(isDatePageTitle('March 2nd, 2026')).toBe(true);
      expect(isDatePageTitle('March 3rd, 2026')).toBe(true);
    });

    it('rejects non-date pages', () => {
      expect(isDatePageTitle('movie recs')).toBe(false);
      expect(isDatePageTitle('March Notes')).toBe(false);
      expect(isDatePageTitle('2026-03-14')).toBe(false);
    });
  });

  describe('listPages', () => {
    it('filters out date pages', async () => {
      vi.mocked(mockClient.getAllPageTitles).mockResolvedValue([
        { title: 'movie recs', uid: 'a1' },
        { title: 'March 14, 2026', uid: 'a2' },
        { title: 'bodylog', uid: 'a3' },
        { title: 'January 1st, 2025', uid: 'a4' },
      ]);
      const pages = await listPages(mockClient);
      expect(pages).toEqual([
        { title: 'bodylog', uid: 'a3' },
        { title: 'movie recs', uid: 'a1' },
      ]);
    });

    it('caps at 500 pages', async () => {
      const manyPages = Array.from({ length: 600 }, (_, i) => ({
        title: `Page ${i}`, uid: `uid${i}`,
      }));
      vi.mocked(mockClient.getAllPageTitles).mockResolvedValue(manyPages);
      const pages = await listPages(mockClient);
      expect(pages.length).toBeLessThanOrEqual(500);
    });
  });

  describe('inspectPage', () => {
    it('returns page with top-level blocks', async () => {
      vi.mocked(mockClient.getPageByTitle).mockResolvedValue({
        uid: 'page1',
        children: [
          { uid: 'c1', string: 'child 1', order: 0 },
          { uid: 'c2', string: 'child 2', order: 1 },
        ],
      });
      const result = await inspectPage(mockClient, 'Test Page');
      expect(result).toEqual({
        title: 'Test Page',
        uid: 'page1',
        children: [
          { uid: 'c1', string: 'child 1', order: 0 },
          { uid: 'c2', string: 'child 2', order: 1 },
        ],
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/integrations/roam-toolkit.test.ts
```

- [ ] **Step 3: Implement toolkit**

Create `src/integrations/roam/toolkit.ts`:
```ts
import type { RoamClient } from './client.js';

const DATE_PAGE_REGEX = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?,\s+\d{4}$/;

export function isDatePageTitle(title: string): boolean {
  return DATE_PAGE_REGEX.test(title);
}

export async function listPages(
  client: RoamClient
): Promise<{ title: string; uid: string }[]> {
  const allPages = await client.getAllPageTitles();
  const filtered = allPages
    .filter(p => !isDatePageTitle(p.title))
    .sort((a, b) => a.title.localeCompare(b.title));
  return filtered.slice(0, 500);
}

export async function inspectPage(
  client: RoamClient,
  title: string
): Promise<{ title: string; uid: string; children: { string: string; uid: string; order: number }[] } | null> {
  const page = await client.getPageByTitle(title);
  if (!page) return null;
  return {
    title,
    uid: page.uid,
    children: page.children.map(c => ({
      string: c.string,
      uid: c.uid,
      order: c.order,
    })),
  };
}
```

Update `src/integrations/roam/index.ts`:
```ts
export { RoamClient } from './client.js';
export * from './types.js';
export { listPages, inspectPage, isDatePageTitle } from './toolkit.js';
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- tests/integrations/roam-toolkit.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/integrations/roam/toolkit.ts src/integrations/roam/index.ts tests/integrations/roam-toolkit.test.ts && git commit -m "feat: add Roam toolkit (listPages, inspectPage)"
```

### Task 6: RoamExecutor

**Files:**
- Create: `src/routes/roam-executor.ts`
- Create: `tests/routes/roam-executor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/routes/roam-executor.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoamExecutor } from '../../src/routes/roam-executor';
import type { Route, Capture, RoamConfig } from '../../src/types';
import type { StorageInterface } from '../../src/storage/interface';

// Mock the RoamClient
vi.mock('../../src/integrations/roam/client', () => ({
  RoamClient: vi.fn().mockImplementation(() => ({
    findBlockOnPage: vi.fn(),
    createBlock: vi.fn().mockResolvedValue(true),
    createPage: vi.fn().mockResolvedValue(true),
    getPageByTitle: vi.fn(),
  })),
}));

import { RoamClient } from '../../src/integrations/roam/client';

describe('RoamExecutor', () => {
  let executor: RoamExecutor;
  let mockStorage: StorageInterface;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = {
      getRoamConfig: vi.fn().mockResolvedValue({
        graphs: [{ graphName: 'test-graph', token: 'roam-graph-token-test', addedAt: '2026-01-01' }],
      } as RoamConfig),
    } as unknown as StorageInterface;
    executor = new RoamExecutor(mockStorage);
  });

  const makeRoute = (operation: unknown): Route => ({
    id: 'route-roam-1',
    name: 'movie-recs',
    description: 'Movie recommendations',
    triggers: [{ type: 'regex', pattern: 'movie', priority: 10 }],
    schema: null,
    recentItems: [],
    destinationType: 'roam',
    destinationConfig: { graphName: 'test-graph', operation },
    transformScript: null,
    createdAt: '2026-01-01',
    createdBy: 'mastermind',
    lastUsed: null,
  });

  const makeCapture = (raw: string): Capture => ({
    id: 'cap-1',
    raw,
    timestamp: '2026-03-14T10:00:00Z',
    username: 'testuser',
    parsed: { explicitRoute: null, payload: raw, metadata: {} },
    routeProposed: null,
    routeConfidence: null,
    routeFinal: null,
    executionTrace: [],
    executionResult: 'pending',
    verificationState: 'pending',
    retiredFromTests: false,
    retiredReason: null,
  });

  describe('blocked_needs_auth', () => {
    it('returns blocked when no Roam config', async () => {
      vi.mocked(mockStorage.getRoamConfig).mockResolvedValue(null);
      const route = makeRoute({ type: 'daily_tagged', tag: 'movie-recs' });
      const result = await executor.execute(route, makeCapture('watch Inception'));
      expect(result.status).toBe('blocked_needs_auth');
    });

    it('returns blocked when graph not found in config', async () => {
      vi.mocked(mockStorage.getRoamConfig).mockResolvedValue({
        graphs: [{ graphName: 'other-graph', token: 'tok', addedAt: '2026-01-01' }],
      });
      const route = makeRoute({ type: 'daily_tagged', tag: 'movie-recs' });
      route.destinationConfig = { graphName: 'missing-graph', operation: { type: 'daily_tagged', tag: 'test' } };
      const result = await executor.execute(route, makeCapture('watch Inception'));
      expect(result.status).toBe('blocked_needs_auth');
    });
  });

  describe('daily_tagged', () => {
    it('creates tag block and child when tag does not exist on today page', async () => {
      const mockClient = vi.mocked(new RoamClient('', ''));
      vi.mocked(RoamClient).mockReturnValue(mockClient);
      vi.mocked(mockClient.findBlockOnPage).mockResolvedValue(null);
      vi.mocked(mockClient.createBlock).mockResolvedValue(true);

      const route = makeRoute({ type: 'daily_tagged', tag: 'movie-recs' });
      const result = await executor.execute(route, makeCapture('watch Inception'));

      expect(result.status).toBe('success');
      // Should create tag block, then content block
      expect(mockClient.createBlock).toHaveBeenCalledTimes(2);
    });

    it('appends to existing tag block', async () => {
      const mockClient = vi.mocked(new RoamClient('', ''));
      vi.mocked(RoamClient).mockReturnValue(mockClient);
      vi.mocked(mockClient.findBlockOnPage).mockResolvedValue({ uid: 'existing-tag', string: '#movie-recs' });
      vi.mocked(mockClient.createBlock).mockResolvedValue(true);

      const route = makeRoute({ type: 'daily_tagged', tag: 'movie-recs' });
      const result = await executor.execute(route, makeCapture('watch Inception'));

      expect(result.status).toBe('success');
      // Should only create content block under existing tag
      expect(mockClient.createBlock).toHaveBeenCalledTimes(1);
      expect(mockClient.createBlock).toHaveBeenCalledWith('existing-tag', 'watch Inception', 'last');
    });
  });

  describe('page_child', () => {
    it('creates page and block when page does not exist', async () => {
      const mockClient = vi.mocked(new RoamClient('', ''));
      vi.mocked(RoamClient).mockReturnValue(mockClient);
      vi.mocked(mockClient.getPageByTitle).mockResolvedValue(null);
      vi.mocked(mockClient.createPage).mockResolvedValue(true);
      vi.mocked(mockClient.createBlock).mockResolvedValue(true);

      const route = makeRoute({ type: 'page_child', pageTitle: 'movie recs' });
      const result = await executor.execute(route, makeCapture('Inception'));

      expect(result.status).toBe('success');
      expect(mockClient.createPage).toHaveBeenCalledWith('movie recs');
    });

    it('appends block to existing page', async () => {
      const mockClient = vi.mocked(new RoamClient('', ''));
      vi.mocked(RoamClient).mockReturnValue(mockClient);
      vi.mocked(mockClient.getPageByTitle).mockResolvedValue({
        uid: 'page1',
        children: [{ uid: 'c1', string: 'existing', order: 0 }],
      });
      vi.mocked(mockClient.createBlock).mockResolvedValue(true);

      const route = makeRoute({ type: 'page_child', pageTitle: 'movie recs' });
      const result = await executor.execute(route, makeCapture('Inception'));

      expect(result.status).toBe('success');
      expect(mockClient.createPage).not.toHaveBeenCalled();
      expect(mockClient.createBlock).toHaveBeenCalledWith('page1', 'Inception', 'last');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- tests/routes/roam-executor.test.ts
```

- [ ] **Step 3: Implement RoamExecutor**

Create `src/routes/roam-executor.ts`:
```ts
import type { Route, Capture } from '../types.js';
import type { StorageInterface } from '../storage/interface.js';
import type { RoamDestinationConfig, DailyTaggedOperation, PageChildOperation } from '../integrations/roam/types.js';
import { RoamClient } from '../integrations/roam/client.js';

export interface RoamExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth';
  error?: string;
  data?: unknown;
}

export class RoamExecutor {
  private storage: StorageInterface;

  constructor(storage: StorageInterface) {
    this.storage = storage;
  }

  async execute(route: Route, capture: Capture): Promise<RoamExecutionResult> {
    const config = route.destinationConfig as RoamDestinationConfig;
    const payload = capture.parsed?.payload || capture.raw;

    // Get Roam credentials
    const roamConfig = await this.storage.getRoamConfig(capture.username);
    if (!roamConfig?.graphs?.length) {
      return { status: 'blocked_needs_auth', error: 'No Roam graphs configured' };
    }

    const graphConfig = roamConfig.graphs.find(g => g.graphName === config.graphName);
    if (!graphConfig) {
      return { status: 'blocked_needs_auth', error: `Roam graph "${config.graphName}" not found in config` };
    }

    const client = new RoamClient(graphConfig.graphName, graphConfig.token);

    try {
      switch (config.operation.type) {
        case 'daily_tagged':
          return await this.executeDailyTagged(client, config.operation, payload);
        case 'page_child':
          return await this.executePageChild(client, config.operation, payload);
        default:
          return { status: 'failed', error: `Unknown operation type: ${(config.operation as { type: string }).type}` };
      }
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async executeDailyTagged(
    client: RoamClient,
    operation: DailyTaggedOperation,
    payload: string
  ): Promise<RoamExecutionResult> {
    const todayTitle = RoamClient.todayPageTitle();
    const todayUid = RoamClient.todayPageUid();

    // Check if tag block already exists on today's page
    const existingTag = await client.findBlockOnPage(todayTitle, operation.tag);

    let parentUid: string;
    if (existingTag) {
      parentUid = existingTag.uid;
    } else {
      // Create the tag block on today's page
      const tagText = operation.tag.startsWith('#') || operation.tag.startsWith('[[')
        ? operation.tag
        : `#${operation.tag}`;
      await client.createBlock(todayUid, tagText, 'last');

      // Find the block we just created (retry with backoff for API consistency)
      let newTag: { uid: string; string: string } | null = null;
      for (let i = 0; i < 3; i++) {
        newTag = await client.findBlockOnPage(todayTitle, operation.tag);
        if (newTag) break;
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
      if (!newTag) {
        return { status: 'failed', error: 'Failed to find newly created tag block after retries' };
      }
      parentUid = newTag.uid;
    }

    // Create the content block under the tag
    await client.createBlock(parentUid, payload, 'last');

    return { status: 'success', data: { parentUid, todayUid } };
  }

  private async executePageChild(
    client: RoamClient,
    operation: PageChildOperation,
    payload: string
  ): Promise<RoamExecutionResult> {
    let parentUid: string;

    if (operation.parentBlockUid) {
      parentUid = operation.parentBlockUid;
    } else {
      // Look up or create the page
      const page = await client.getPageByTitle(operation.pageTitle);
      if (page) {
        parentUid = page.uid;
      } else {
        await client.createPage(operation.pageTitle);
        const newPage = await client.getPageByTitle(operation.pageTitle);
        if (!newPage) {
          return { status: 'failed', error: `Failed to create page "${operation.pageTitle}"` };
        }
        parentUid = newPage.uid;
      }
    }

    await client.createBlock(parentUid, payload, 'last');
    return { status: 'success', data: { parentUid } };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- tests/routes/roam-executor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/roam-executor.ts tests/routes/roam-executor.test.ts && git commit -m "feat: add RoamExecutor with daily_tagged and page_child modes"
```

### Task 7: Wire into RouteExecutor

**Files:**
- Modify: `src/routes/executor.ts`

- [ ] **Step 1: Add RoamExecutor to RouteExecutor**

In `src/routes/executor.ts`:

Add import:
```ts
import { RoamExecutor } from './roam-executor.js';
```

Add field:
```ts
private roamExecutor: RoamExecutor | null;
```

In constructor, after `this.sheetsExecutor = ...`:
```ts
this.roamExecutor = storage ? new RoamExecutor(storage) : null;
```

Add dispatch branch after the sheets block (before the `// Only handle 'fs'` comment):
```ts
    // Handle roam destination type
    if (route.destinationType === 'roam') {
      if (!this.roamExecutor || !capture) {
        return {
          success: false,
          status: 'failed',
          error: 'RoamExecutor not configured or capture not provided',
        };
      }
      const roamResult = await this.roamExecutor.execute(route, capture);
      return {
        success: roamResult.status === 'success',
        status: roamResult.status,
        error: roamResult.error,
      };
    }
```

- [ ] **Step 2: Build to verify**

```bash
pnpm build
```

- [ ] **Step 3: Run existing tests to make sure nothing broke**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/executor.ts && git commit -m "feat: wire RoamExecutor into RouteExecutor dispatch"
```

### Task 8: Pipeline context injection + Mastermind prompt

**Files:**
- Modify: `src/mastermind/index.ts`
- Modify: `src/pipeline/index.ts`

- [ ] **Step 1: Add RoamContextEntry to Mastermind types**

In `src/mastermind/index.ts`, add after `SheetsContextEntry`:
```ts
export interface RoamContextEntry {
  graphName: string;
  pages: string[];
}
```

Add to `IntegrationContext`:
```ts
  roamContext?: {
    graphs: RoamContextEntry[];
  };
```

- [ ] **Step 2: Add Roam section to buildIntegrationSection**

In `buildIntegrationSection`, after the `sheetsContext` block (before `section +=`):
```ts
    // Add Roam graph context
    if (context.roamContext?.graphs.length) {
      const roamLines = context.roamContext.graphs.map(g => {
        const pageList = g.pages.slice(0, 50).join(', ');
        const suffix = g.pages.length > 50 ? `, ... (${g.pages.length} total)` : '';
        return `  Graph "${g.graphName}": ${pageList}${suffix}`;
      }).join('\n');

      section += `\n\nYour Roam Research graphs:\n${roamLines}`;
    }
```

- [ ] **Step 3: Add Roam destination docs to buildPrompt**

In `buildPrompt`, add after the "sheets" section in the route destination types block:
```
### "roam" - Roam Research
destinationConfig: {graphName: "<graph name from list>", operation: <operation>}
No transformScript needed — the Roam executor handles everything.

Operations:
- daily_tagged: Write to today's daily page under a tag.
  operation: {type: "daily_tagged", tag: "<tag name>"}
  Creates: #tag as child of today's page, then capture text as child of tag block.
  If #tag already exists on today's page, appends as sibling of existing entries.
  Use for: daily logging, journal-style entries, anything time-organized.

- page_child: Append as child of a named page.
  operation: {type: "page_child", pageTitle: "<page title>"}
  Creates the page if it doesn't exist.
  Use for: lists, collections, reference material that lives on its own page.

graphName is set at the destinationConfig level (not inside operation).
When choosing a graph, look at which graph contains matching pages in the list above.
Daily page UIDs are deterministic — no lookup needed.
Fuzzy-match page names (singular/plural, with/without hash/brackets).
The capture payload should include [[page refs]] where you identify existing pages that are referenced (e.g. person names, topics).
```

- [ ] **Step 4: Add Roam context gathering to pipeline**

In `src/pipeline/index.ts`, in `gatherIntegrationContext()`, add after the `sheetsContext` block:

Add imports at top:
```ts
import { RoamClient } from '../integrations/roam/client.js';
import { listPages } from '../integrations/roam/toolkit.js';
import type { RoamContextEntry } from '../mastermind/index.js';
```

Add before the return statement:
```ts
    // Fetch Roam context if connected
    const roamIntegration = integrations.find(i => i.id === 'roam');
    let roamContext: IntegrationContext['roamContext'];

    if (roamIntegration?.status === 'connected') {
      try {
        const roamConfig = await this.storage.getRoamConfig(username);
        if (roamConfig?.graphs.length) {
          const graphs: RoamContextEntry[] = [];
          for (const graph of roamConfig.graphs) {
            try {
              const client = new RoamClient(graph.graphName, graph.token);
              const pages = await listPages(client);
              graphs.push({ graphName: graph.graphName, pages: pages.map(p => p.title) });
            } catch (error) {
              console.error(`[Pipeline] Failed to fetch Roam pages for graph ${graph.graphName}:`, error);
              graphs.push({ graphName: graph.graphName, pages: [] });
            }
          }
          roamContext = { graphs };
        }
      } catch (error) {
        console.error('[Pipeline] Failed to fetch Roam context:', error);
      }
    }
```

Add `roamContext` to the return object.

- [ ] **Step 5: Build and run tests**

```bash
pnpm build && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add src/mastermind/index.ts src/pipeline/index.ts && git commit -m "feat: add Roam context injection to Mastermind and pipeline"
```

---

## Chunk 3: Server Routes, Dashboard, E2E Tests

### Task 9: Server endpoints for graph connection

**Files:**
- Create: `src/server/roam.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Create Roam server routes**

Create `src/server/roam.ts`:
```ts
import type { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import { RoamClient } from '../integrations/roam/client.js';

export function buildRoamRoutes(app: Hono, storage: StorageInterface): void {
  // Connect a Roam graph
  app.post('/api/roam/connect', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'Not authenticated' }, 401);

    const { graphName, token } = await c.req.json();
    if (!graphName || !token) {
      return c.json({ error: 'graphName and token are required' }, 400);
    }

    // Test the connection
    try {
      const client = new RoamClient(graphName, token);
      await client.getAllPageTitles();
    } catch (error) {
      return c.json({
        error: `Failed to connect to graph "${graphName}": ${error instanceof Error ? error.message : String(error)}`,
      }, 400);
    }

    // Save to config
    const existing = await storage.getRoamConfig(auth.uid) || { graphs: [] };
    const filtered = existing.graphs.filter(g => g.graphName !== graphName);
    filtered.push({ graphName, token, addedAt: new Date().toISOString() });
    await storage.saveRoamConfig(auth.uid, { graphs: filtered });

    return c.json({ success: true, graphName });
  });

  // Disconnect a Roam graph
  app.delete('/api/roam/disconnect/:graphName', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'Not authenticated' }, 401);

    const graphName = c.req.param('graphName');
    const existing = await storage.getRoamConfig(auth.uid);
    if (!existing) return c.json({ error: 'No Roam config' }, 404);

    const filtered = existing.graphs.filter(g => g.graphName !== graphName);
    if (filtered.length === 0) {
      await storage.clearRoamConfig(auth.uid);
    } else {
      await storage.saveRoamConfig(auth.uid, { graphs: filtered });
    }

    return c.json({ success: true });
  });

  // Form-based connect (for dashboard)
  app.post('/connect/roam', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.redirect('/login');

    const formData = await c.req.parseBody();
    const graphName = formData.graphName as string;
    const token = formData.token as string;

    if (!graphName || !token) {
      return c.redirect('/dashboard/auth?error=missing_fields');
    }

    // Test connection
    try {
      const client = new RoamClient(graphName, token);
      await client.getAllPageTitles();
    } catch {
      return c.redirect('/dashboard/auth?error=connection_failed');
    }

    const existing = await storage.getRoamConfig(auth.uid) || { graphs: [] };
    const filtered = existing.graphs.filter(g => g.graphName !== graphName);
    filtered.push({ graphName, token, addedAt: new Date().toISOString() });
    await storage.saveRoamConfig(auth.uid, { graphs: filtered });

    return c.redirect('/dashboard/auth');
  });

  // Form-based disconnect
  app.post('/disconnect/roam/:graphName', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.redirect('/login');

    const graphName = c.req.param('graphName');
    const redirect = c.req.query('redirect') || '/dashboard/auth';

    const existing = await storage.getRoamConfig(auth.uid);
    if (existing) {
      const filtered = existing.graphs.filter(g => g.graphName !== graphName);
      if (filtered.length === 0) {
        await storage.clearRoamConfig(auth.uid);
      } else {
        await storage.saveRoamConfig(auth.uid, { graphs: filtered });
      }
    }

    return c.redirect(redirect);
  });
}
```

- [ ] **Step 2: Wire into server**

In `src/server/index.ts`, add import:
```ts
import { buildRoamRoutes } from './roam.js';
```

After `buildOAuthRoutes(app, ...)`, add:
```ts
buildRoamRoutes(app, storage);
```

- [ ] **Step 3: Build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/server/roam.ts src/server/index.ts && git commit -m "feat: add Roam graph connect/disconnect server endpoints"
```

### Task 10: Dashboard UI

**Files:**
- Modify: `src/dashboard/routes.ts`

- [ ] **Step 1: Update auth page to show Roam integration with add/remove UI**

In `src/dashboard/routes.ts`, in the auth page handler, update the actions column for integrations. Replace the actions `td` content (currently handles only `oauth` and `none` auth types) with logic that also handles `api-key`:

Find the `<td>` block in the integrations table that starts with `${i.authType === 'oauth' ? ...}` and update it to handle Roam:

```ts
                <td>
                  ${i.authType === 'oauth' ? `
                    ${i.status === 'connected' ? `
                      <form method="post" action="/disconnect/${i.id}?redirect=/dashboard/auth" style="display: inline;">
                        <button type="submit" class="btn btn-danger">Disconnect</button>
                      </form>
                    ` : `
                      <a href="/connect/${i.id}" class="btn btn-primary">Connect</a>
                    `}
                  ` : i.id === 'roam' ? `
                    ${i.status === 'connected' ? '<span class="badge badge-success">Connected</span>' : ''}
                  ` : '<span class="text-muted">No auth needed</span>'}
                </td>
```

Then, after the integrations table closing `</div>`, add a Roam management section. This requires fetching Roam config at the start of the handler:

At the top of the handler, add:
```ts
    const roamConfig = await storage.getRoamConfig(auth.uid);
```

After the integrations table card, add:
```ts
      <div class="card">
        <h3>Roam Research Graphs</h3>
        ${roamConfig?.graphs?.length ? `
          <table>
            <thead>
              <tr><th>Graph</th><th>Connected</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${roamConfig.graphs.map(g => `
                <tr>
                  <td><strong>${escapeHtml(g.graphName)}</strong></td>
                  <td class="text-muted">${formatDate(g.addedAt)}</td>
                  <td>
                    <form method="post" action="/disconnect/roam/${escapeHtml(g.graphName)}?redirect=/dashboard/auth" style="display: inline;">
                      <button type="submit" class="btn btn-danger">Remove</button>
                    </form>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p class="text-muted">No Roam graphs connected</p>'}
        <h4 style="margin-top: 1rem;">Add Graph</h4>
        <form method="post" action="/connect/roam">
          <div style="display: flex; gap: 0.5rem; align-items: flex-end;">
            <div>
              <label>Graph Name</label>
              <input type="text" name="graphName" placeholder="my-graph" required style="width: 200px;">
            </div>
            <div>
              <label>API Token</label>
              <input type="password" name="token" placeholder="roam-graph-token-..." required style="width: 300px;">
            </div>
            <button type="submit" class="btn btn-primary">Connect</button>
          </div>
        </form>
      </div>
```

- [ ] **Step 2: Build and verify**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/routes.ts && git commit -m "feat: add Roam graph management UI to dashboard auth page"
```

### Task 11: Seed test graph with realistic data

**Files:**
- Create: `tmp/seed-roam-graph.ts`

- [ ] **Step 1: Create seed script**

Create `tmp/seed-roam-graph.ts`:
```ts
import { config } from 'dotenv';
config();

import { initializeGraph, q, createBlock, createPage } from '@roam-research/roam-api-sdk';

const graphName = process.env.ROAM_TEST_GRAPH_NAME!;
const token = process.env.ROAM_TEST_GRAPH_TOKEN!;

if (!graphName || !token) {
  console.error('Set ROAM_TEST_GRAPH_NAME and ROAM_TEST_GRAPH_TOKEN');
  process.exit(1);
}

const graph = initializeGraph({ graph: graphName, token });

async function seed() {
  console.log(`Seeding graph: ${graphName}`);

  // Create some pages
  const pages = ['movie recs', 'book list', 'project ideas', 'bodylog', 'quotes', 'recipes'];
  for (const page of pages) {
    try {
      await createPage(graph, { action: 'create-page', page: { title: page } });
      console.log(`Created page: ${page}`);
    } catch (e) {
      console.log(`Page "${page}" may already exist: ${e}`);
    }
  }

  // Add some blocks to movie recs
  const moviePage = await findPageUid('movie recs');
  if (moviePage) {
    const movies = [
      '[[Terminator 2]] - recommended by [[Bob]]',
      '[[Inception]] - saw on a flight',
      '[[The Matrix]] - classic',
    ];
    for (const movie of movies) {
      await createBlock(graph, {
        action: 'create-block',
        location: { 'parent-uid': moviePage, order: 'last' },
        block: { string: movie },
      });
    }
    console.log(`Added ${movies.length} movies`);
  }

  // Add some blocks to bodylog
  const bodylogPage = await findPageUid('bodylog');
  if (bodylogPage) {
    const entries = [
      'weight: 185.5 lbs',
      'weight: 184.0 lbs',
      'ran 5k in 28 min',
    ];
    for (const entry of entries) {
      await createBlock(graph, {
        action: 'create-block',
        location: { 'parent-uid': bodylogPage, order: 'last' },
        block: { string: entry },
      });
    }
    console.log(`Added ${entries.length} bodylog entries`);
  }

  // Add tagged blocks to today's page
  const today = new Date();
  const todayTitle = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
  const todayDay = String(today.getDate()).padStart(2, '0');
  const todayUid = `${todayMonth}-${todayDay}-${today.getFullYear()}`;

  try {
    // Create a tag block on today's page
    await createBlock(graph, {
      action: 'create-block',
      location: { 'parent-uid': todayUid, order: 'last' },
      block: { string: '#movie-recs' },
    });

    // Find the tag block we just created
    const tagResults = await q(graph,
      '[:find ?uid ?str :in $ ?page-title ?search :where [?p :node/title ?page-title] [?p :block/children ?b] [?b :block/uid ?uid] [?b :block/string ?str] [(clojure.string/includes? ?str ?search)]]',
      [todayTitle, 'movie-recs']
    ) as [string, string][];

    if (tagResults.length > 0) {
      await createBlock(graph, {
        action: 'create-block',
        location: { 'parent-uid': tagResults[0][0], order: 'last' },
        block: { string: 'watch [[Blade Runner 2049]]' },
      });
      console.log('Added tagged block on today\'s page');
    }
  } catch (e) {
    console.log(`Today page blocks: ${e}`);
  }

  console.log('Seeding complete!');
}

async function findPageUid(title: string): Promise<string | null> {
  const results = await q(graph,
    '[:find ?uid :in $ ?title :where [?p :node/title ?title] [?p :block/uid ?uid]]',
    [title]
  ) as [string][];
  return results.length > 0 ? results[0][0] : null;
}

seed().catch(console.error);
```

- [ ] **Step 2: Run the seed script**

```bash
pnpm tsx tmp/seed-roam-graph.ts
```

- [ ] **Step 3: Commit**

```bash
git add tmp/seed-roam-graph.ts && git commit -m "test: add Roam graph seeding script"
```

### Task 12: Live integration tests

**Files:**
- Create: `tests/integrations/roam-live.test.ts`

- [ ] **Step 1: Write live integration tests**

Create `tests/integrations/roam-live.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { config } from 'dotenv';
config();

import { RoamClient } from '../../src/integrations/roam/client';
import { listPages, inspectPage } from '../../src/integrations/roam/toolkit';

const graphName = process.env.ROAM_TEST_GRAPH_NAME;
const token = process.env.ROAM_TEST_GRAPH_TOKEN;

const itLive = graphName && token ? it : it.skip;

describe('Roam live integration', () => {
  let client: RoamClient;

  beforeAll(() => {
    if (graphName && token) {
      client = new RoamClient(graphName, token);
    }
  });

  itLive('can list all page titles', async () => {
    const pages = await client.getAllPageTitles();
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toHaveProperty('title');
    expect(pages[0]).toHaveProperty('uid');
  });

  itLive('can search pages', async () => {
    const pages = await client.searchPages('movie');
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].title.toLowerCase()).toContain('movie');
  });

  itLive('can get page by title', async () => {
    const page = await client.getPageByTitle('movie recs');
    expect(page).not.toBeNull();
    expect(page!.uid).toBeTruthy();
  });

  itLive('returns null for non-existent page', async () => {
    const page = await client.getPageByTitle('nonexistent-page-xyz-12345');
    expect(page).toBeNull();
  });

  itLive('listPages filters date pages', async () => {
    const pages = await listPages(client);
    const datePages = pages.filter(p => /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/.test(p.title));
    expect(datePages).toHaveLength(0);
  });

  itLive('inspectPage returns children', async () => {
    const result = await inspectPage(client, 'movie recs');
    expect(result).not.toBeNull();
    expect(result!.children.length).toBeGreaterThan(0);
  });

  itLive('todayPageUid matches actual daily page UID format', async () => {
    // Verify our deterministic UID matches what Roam actually uses
    const todayTitle = RoamClient.todayPageTitle();
    const page = await client.getPageByTitle(todayTitle);
    if (page) {
      // If today's page exists, verify the UID format matches
      expect(page.uid).toBe(RoamClient.todayPageUid());
    }
    // If today's page doesn't exist yet, at least verify format is MM-DD-YYYY
    expect(RoamClient.todayPageUid()).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });

  itLive('can create and find a block', async () => {
    const todayUid = RoamClient.todayPageUid();
    const testText = `test-block-${Date.now()}`;

    await client.createBlock(todayUid, testText);

    const todayTitle = RoamClient.todayPageTitle();
    const found = await client.findBlockOnPage(todayTitle, testText);
    expect(found).not.toBeNull();
    expect(found!.string).toBe(testText);
  });
});
```

- [ ] **Step 2: Run live tests**

```bash
pnpm test -- tests/integrations/roam-live.test.ts
```

These will only run when env vars are present. Expected: PASS (if test graph was seeded).

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/roam-live.test.ts && git commit -m "test: add Roam live integration tests against test graph"
```

### Task 13: E2E Playwright tests

**Files:**
- Create: `tests/e2e/roam-routing.spec.ts`

- [ ] **Step 1: Write E2E test for Roam connection and routing**

Create `tests/e2e/roam-routing.spec.ts`. Follow the patterns in existing E2E tests (check `tests/e2e/sheets-routing.spec.ts` for reference). The test should:

1. Log in via the widget
2. Navigate to dashboard auth page
3. Fill in graph name + token from env vars
4. Submit the form
5. Verify the graph appears in the connected list
6. Send a capture through the widget that should route to Roam (e.g. "movie reco Inception, roam ctest")
7. Verify the capture shows as successful in the dashboard

**Important notes:**
- Use `process.env.ROAM_TEST_GRAPH_NAME` and `process.env.ROAM_TEST_GRAPH_TOKEN`
- Skip if env vars not present
- Check existing sheets-routing.spec.ts for the exact auth/login pattern to follow

```ts
import { test, expect } from '@playwright/test';

const graphName = process.env.ROAM_TEST_GRAPH_NAME;
const token = process.env.ROAM_TEST_GRAPH_TOKEN;

test.describe('Roam routing E2E', () => {
  test.skip(!graphName || !token, 'Roam test credentials not configured');

  // Follow the exact login pattern from sheets-routing.spec.ts
  // Then test graph connection and capture routing
});
```

The E2E test implementation will need to match the exact login flow of the existing specs. Read `tests/e2e/sheets-routing.spec.ts` for the pattern.

- [ ] **Step 2: Run E2E tests**

```bash
pnpm exec playwright test tests/e2e/roam-routing.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/roam-routing.spec.ts && git commit -m "test: add Roam routing E2E tests"
```

### Task 14: Final integration test — run all tests

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 2: Run E2E tests**

```bash
pnpm exec playwright test
```

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "fix: address test failures from Roam integration"
```
