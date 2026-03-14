# Roam Research Integration Design

## Overview

Add Roam Research as a destination type in Slapture, allowing captures to be routed to blocks in Roam graphs. Users connect graphs via API tokens (not OAuth). The Mastermind gets Roam page context to make routing decisions.

## Auth & Storage

### Token model

Roam uses graph-level API tokens (format: `roam-graph-token-*`), created in Roam Settings > Graph > API tokens. No OAuth flow — users paste graph name + token pairs.

A user can have multiple graphs connected.

### Storage

Stored in the existing per-user Firestore doc at `users/{username}` under `data.integrations.roam`, following the exact same pattern as Sheets/Intend tokens (merge write, single doc per user).

**StorageInterface additions:**
```ts
getRoamConfig(username: string): Promise<RoamConfig | null>;
saveRoamConfig(username: string, config: RoamConfig): Promise<void>;
clearRoamConfig(username: string): Promise<void>;
```

Both `Storage` (local) and `FirestoreStorage` need implementations.

**Types (in `src/types.ts`):**
```ts
interface RoamGraphConfig {
  graphName: string;
  token: string;
  addedAt: string;  // ISO 8601
}

interface RoamConfig {
  graphs: RoamGraphConfig[];
}
```

Also add `roam?: RoamConfig` to the `IntegrationConfig` type.

### Registry entry

```ts
{
  id: 'roam',
  name: 'Roam Research',
  purpose: 'Create blocks and pages in Roam graphs — daily pages, tagged entries, structured notes',
  authType: 'api-key',
}
```

Status: `connected` if `graphs.length > 0`, `never` if no config or empty array.

## Client

### `src/integrations/roam/client.ts`

Thin wrapper around `@roam-research/roam-api-sdk` (npm package). The SDK hits the hosted API at `https://api.roamresearch.com`.

```ts
class RoamClient {
  constructor(graphName: string, token: string);

  // Query — wraps SDK's q() with Datalog queries
  searchPages(query: string): Promise<{title: string, uid: string}[]>;
  getAllPageTitles(): Promise<{title: string, uid: string}[]>;
  getPageByTitle(title: string): Promise<{uid: string, children: Block[]} | null>;
  getBlockChildren(uid: string): Promise<Block[]>;
  // Searches only direct children of a page — intentional, since
  // daily_tagged needs the top-level tag block, not deeply nested matches
  // Takes page title (not UID) because the Datalog query uses :node/title
  findBlockOnPage(pageTitle: string, text: string): Promise<{uid: string, string: string} | null>;

  // Write — wraps SDK's createBlock/createPage
  createPage(title: string): Promise<boolean>;
  createBlock(parentUid: string, text: string, order?: 'last' | number): Promise<boolean>;

  // Daily page helpers (deterministic — no API call)
  // Note: verify UID format against actual Roam API during implementation
  static todayPageTitle(): string;      // "March 14, 2026"
  static todayPageUid(): string;        // "03-14-2026"
  static datePageTitle(date: Date): string;
  static datePageUid(date: Date): string;
}

interface Block {
  uid: string;
  string: string;
  order: number;
  children?: Block[];
}
```

**Key Datalog queries:**

```clojure
;; Get all page titles (for listPages)
[:find ?title ?uid
 :where [?p :node/title ?title]
        [?p :block/uid ?uid]]

;; Search pages by substring
[:find ?title ?uid
 :in $ ?search
 :where [?p :node/title ?title]
        [?p :block/uid ?uid]
        [(clojure.string/includes? ?title ?search)]]

;; Get page children (for inspectPage)
;; Uses pull: (pull ?e [:block/uid :block/string :block/order {:block/children [:block/uid :block/string :block/order]}])
;; with eid: [:node/title "Page Title"]

;; Find block with matching text on a page (direct children only)
[:find ?uid ?str
 :in $ ?page-title ?search
 :where [?p :node/title ?page-title]
        [?p :block/children ?b]
        [?b :block/uid ?uid]
        [?b :block/string ?str]
        [(clojure.string/includes? ?str ?search)]]
```

## Toolkit

### `src/integrations/roam/toolkit.ts`

Higher-level functions for the pipeline.

```ts
// For Mastermind context injection
// Filters out daily pages (Month DD, YYYY pattern)
// V1: returns all non-daily page titles, capped at 500, sorted alphabetically
// Future optimization: sort by recency/reference count
async function listPages(client: RoamClient): Promise<{title: string, uid: string}[]>;

// For Mastermind on-demand inspection (future: used by Mastermind tool-use)
// For v1: called by pipeline and injected into context for top candidate pages
async function inspectPage(client: RoamClient, title: string): Promise<{
  title: string;
  uid: string;
  children: {string: string, uid: string, order: number}[];  // top-level blocks only
}>;
```

**Date page filter:** regex `/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(st|nd|rd|th)?,\s+\d{4}$/` on page titles.

## Executor

### `src/routes/roam-executor.ts`

Follows the SheetsExecutor/IntendExecutor pattern.

**Block content** is `capture.parsed?.payload || capture.raw` (same as other executors).

```ts
interface RoamExecutionResult {
  status: 'success' | 'failed' | 'blocked_needs_auth';
  error?: string;
  data?: unknown;
}

type RoamOperation = DailyTaggedOperation | PageChildOperation;

// Write to today's daily page under a tag/page-ref
interface DailyTaggedOperation {
  type: 'daily_tagged';
  tag: string;          // e.g. "movie-recs" — written as #movie-recs or [[movie recs]]
}

// Append as child of a block on a named page
interface PageChildOperation {
  type: 'page_child';
  pageTitle: string;    // e.g. "movie recs"
  parentBlockUid?: string;  // optional: nest under specific block
}

// graphName lives here only (not duplicated in operations)
interface RoamDestinationConfig {
  graphName: string;
  operation: RoamOperation;
}

class RoamExecutor {
  constructor(storage: StorageInterface);

  async execute(route: Route, capture: Capture): Promise<RoamExecutionResult>;
}
```

### `daily_tagged` execution flow

1. Compute today's page UID deterministically (`RoamClient.todayPageUid()`)
2. Query today's page for an existing block containing `#tag` or `[[tag]]` as a direct child
3. If found → `createBlock()` the capture text as a child of that tag block
4. If not found → `createBlock()` the tag block on today's page, then `createBlock()` the capture text as its child

Result on today's page:
```
- #movie-recs
  - [[Vincent]] recommended watching Terminator 2
  - watch Inception
```

### `page_child` execution flow

1. Look up the page by title using `getPageByTitle()`
2. If page doesn't exist → `createPage()`
3. If `parentBlockUid` is set → `createBlock()` as child of that specific block
4. Otherwise → `createBlock()` as last child of the page

### RouteExecutor integration

In `src/routes/executor.ts`:
- Add `private roamExecutor: RoamExecutor | null` field
- Initialize in constructor: `this.roamExecutor = storage ? new RoamExecutor(storage) : null`
- Add dispatch branch: `if (route.destinationType === 'roam') { ... }` following the same pattern as sheets/intend/notes

## Mastermind Integration

### Context injection

In `CapturePipeline.gatherIntegrationContext()` (`src/pipeline/index.ts`), add a Roam block following the existing Sheets pattern:

```ts
// Fetch Roam context if Roam is connected
const roamIntegration = integrations.find(i => i.id === 'roam');
if (roamIntegration?.status === 'connected') {
  const roamConfig = await this.storage.getRoamConfig(username);
  if (roamConfig?.graphs.length) {
    const roamGraphs: RoamContextEntry[] = [];
    for (const graph of roamConfig.graphs) {
      const client = new RoamClient(graph.graphName, graph.token);
      const pages = await listPages(client);
      roamGraphs.push({ graphName: graph.graphName, pages: pages.map(p => p.title) });
    }
    roamContext = { graphs: roamGraphs };
  }
}
```

**New types (in `src/mastermind/index.ts`):**
```ts
interface RoamContextEntry {
  graphName: string;
  pages: string[];
}

// Add to IntegrationContext:
roamContext?: {
  graphs: RoamContextEntry[];
};
```

**Mastermind `buildIntegrationSection()` addition:**
```ts
if (context.roamContext?.graphs.length) {
  const roamLines = context.roamContext.graphs.map(g => {
    const pageList = g.pages.slice(0, 50).join(', ');
    return `  Graph "${g.graphName}": ${pageList}${g.pages.length > 50 ? `, ... (${g.pages.length} total)` : ''}`;
  }).join('\n');
  section += `\n\nYour Roam Research graphs:\n${roamLines}`;
}
```

### Mastermind tool-use: deferred to v2

The `inspectRoamPage` tool is deferred. For v1, the page list in the context gives the Mastermind enough to pick the right graph + page. The Mastermind can create routes based on page names alone — it doesn't need to see block structure to choose between `daily_tagged` and `page_child` (the user's hint and the nature of the input are sufficient).

If needed later, this would involve switching the Mastermind from single-message to tool-use mode, which is a broader architectural change.

### Prompt docs

New section in the Mastermind prompt (in `buildPrompt()`):

```
### "roam" - Roam Research
destinationConfig: {graphName: "<graph name>", operation: <operation>}
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
When choosing a graph, look at which graph contains matching pages.
Daily page UIDs are deterministic — no lookup needed.
Fuzzy-match page names (singular/plural, with/without hash/brackets).
The capture payload should include [[page refs]] where the Mastermind identifies
existing pages that are referenced (e.g. person names, topics).
```

## Route type addition

`destinationType` union in `src/types.ts` becomes: `'fs' | 'intend' | 'notes' | 'sheets' | 'roam'`

`destinationConfig` union gets: `| RoamDestinationConfig`

## Dashboard UI

### Integration card

On the integrations page, add a "Roam Research" card:
- Shows connected graphs with names
- "Add Graph" button → form with graph name + token fields
- Per-graph: remove button, test connection button (does a simple `q()` to verify)

### API endpoints

`POST /api/roam/connect` — accepts `{graphName, token}`, stores via `saveRoamConfig()`.
`DELETE /api/roam/disconnect/:graphName` — removes a graph from the config via `clearRoamConfig()` (or updates config minus that graph).

No OAuth redirect flow. No callback URIs.

### Status display

Registry status logic:
- `connected` if at least one graph configured
- `never` if no config or empty array
- No `expired` state (graph tokens don't expire, they're revoked manually)

## File structure

```
src/integrations/roam/
  client.ts       — RoamClient wrapper around roam-api-sdk
  toolkit.ts      — listPages, inspectPage for pipeline context
  types.ts        — RoamConfig, Block, RoamDestinationConfig, operation types
  index.ts        — re-exports

src/routes/
  roam-executor.ts — RoamExecutor with daily_tagged + page_child

src/server/
  roam.ts          — POST/DELETE endpoints for graph connection
```

## Dependencies

- `@roam-research/roam-api-sdk` — official Roam backend API SDK

## Testing approach

- Unit tests for RoamClient (mock the SDK), RoamExecutor operations, toolkit filtering
- Use the test graph (`ctest` with token from `ROAM_TEST_GRAPH_TOKEN` / `ROAM_TEST_GRAPH_NAME` env vars) for integration tests
- Populate test graph with realistic data (journal entries, tagged blocks, various page structures) to test against
- E2E Playwright tests for the connection flow and end-to-end capture routing
- Both `Storage` (local) and `FirestoreStorage` implementations tested
