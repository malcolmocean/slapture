# Slapture Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an intelligent capture routing system that parses text inputs, matches them to routes via deterministic rules, and uses Opus (Mastermind) to handle novel inputs and create new routes with filesystem operations.

**Architecture:** HTTP server receives captures, Parser extracts structure, Dispatcher matches routes, Route Handler executes transformScripts in node:vm against filestore/{username}/. Mastermind (Opus API) handles unmatched captures and generates new routes with custom transformScripts.

**Tech Stack:** TypeScript, Fastify (HTTP), node:vm (sandboxing), Vitest (unit tests), Playwright (E2E), Anthropic SDK

---

## Task 1: Project Scaffolding

**Files:**
- Create: `src/index.ts`
- Create: `src/types.ts`
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`

**Step 1: Install dependencies**

Run:
```bash
pnpm add fastify @anthropic-ai/sdk uuid
pnpm add -D typescript @types/node vitest @playwright/test
```
Expected: packages installed successfully

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**Step 4: Create playwright.config.ts**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

**Step 5: Update package.json scripts**

```json
{
  "name": "slapture",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch & node --watch dist/index.js",
    "test": "vitest",
    "test:e2e": "playwright test"
  },
  "packageManager": "pnpm@10.8.1",
  "dependencies": {
    "@anthropic-ai/sdk": "...",
    "fastify": "...",
    "uuid": "..."
  },
  "devDependencies": {
    "@playwright/test": "...",
    "@types/node": "...",
    "typescript": "...",
    "vitest": "..."
  }
}
```

**Step 6: Create directory structure**

Run:
```bash
mkdir -p src/{parser,dispatcher,routes,mastermind,storage}
mkdir -p tests/{unit,e2e}
mkdir -p data/{captures,routes,executions}
mkdir -p filestore/default
```

**Step 7: Create src/types.ts with core interfaces**

```typescript
export interface Capture {
  id: string;
  raw: string;
  timestamp: string;

  parsed: {
    explicitRoute: string | null;
    payload: string;
    metadata: Record<string, string>;
  } | null;

  routeProposed: string | null;
  routeConfidence: 'high' | 'medium' | 'low' | null;
  routeFinal: string | null;

  executionTrace: ExecutionStep[];
  executionResult: 'success' | 'failed' | 'pending' | 'rejected';

  verificationState:
    | 'human_verified'
    | 'ai_certain'
    | 'ai_uncertain'
    | 'failed'
    | 'pending';

  retiredFromTests: boolean;
  retiredReason: string | null;
}

export interface ExecutionStep {
  step: 'parse' | 'dispatch' | 'route_validate' | 'execute' | 'mastermind';
  timestamp: string;
  input: unknown;
  output: unknown;
  codeVersion: string;
  durationMs: number;
}

export interface Route {
  id: string;
  name: string;
  description: string;

  triggers: RouteTrigger[];

  schema: string | null;
  recentItems: CaptureRef[];

  destinationType: 'fs';
  destinationConfig: {
    filePath: string;
  };
  transformScript: string | null;

  createdAt: string;
  createdBy: 'user' | 'mastermind';
  lastUsed: string | null;
}

export interface RouteTrigger {
  type: 'prefix' | 'regex' | 'keyword' | 'semantic';
  pattern: string;
  priority: number;
}

export interface CaptureRef {
  captureId: string;
  raw: string;
  timestamp: string;
  wasCorrect: boolean;
}

export interface Config {
  authToken: string;
  requireApproval: boolean;
  approvalGuardPrompt: string | null;
  mastermindRetryAttempts: number;
}

export interface ParseResult {
  explicitRoute: string | null;
  payload: string;
  metadata: Record<string, string>;
}

export interface DispatchResult {
  routeId: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  reason: string;
}

export interface MastermindAction {
  action: 'route' | 'create' | 'clarify' | 'inbox';
  routeId?: string;
  route?: Omit<Route, 'id' | 'createdAt' | 'lastUsed' | 'recentItems'>;
  question?: string;
  reason: string;
}
```

**Step 8: Create placeholder src/index.ts**

```typescript
console.log('Slapture starting...');
```

**Step 9: Verify build works**

Run: `pnpm build`
Expected: Compiles without errors, creates dist/

**Step 10: Commit**

```bash
git add -A
git commit -m "chore: project scaffolding with types"
```

---

## Task 2: Storage Layer

**Files:**
- Create: `src/storage/index.ts`
- Create: `tests/unit/storage.test.ts`

**Step 1: Write failing test for capture storage**

```typescript
// tests/unit/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../../src/storage/index.js';
import { Capture } from '../../src/types.js';
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
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/storage.test.ts`
Expected: FAIL with module not found

**Step 3: Implement Storage class**

```typescript
// src/storage/index.ts
import fs from 'fs';
import path from 'path';
import { Capture, Route, Config, ExecutionStep } from '../types.js';

export class Storage {
  private dataDir: string;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.dataDir,
      path.join(this.dataDir, 'captures'),
      path.join(this.dataDir, 'routes'),
      path.join(this.dataDir, 'executions'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  // Captures
  async saveCapture(capture: Capture): Promise<void> {
    const filePath = path.join(this.dataDir, 'captures', `${capture.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(capture, null, 2));
  }

  async getCapture(id: string): Promise<Capture | null> {
    const filePath = path.join(this.dataDir, 'captures', `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Capture;
  }

  async listCaptures(limit: number = 50): Promise<Capture[]> {
    const capturesDir = path.join(this.dataDir, 'captures');
    if (!fs.existsSync(capturesDir)) {
      return [];
    }
    const files = fs.readdirSync(capturesDir)
      .filter(f => f.endsWith('.json'))
      .slice(0, limit);

    const captures: Capture[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(capturesDir, file), 'utf-8');
      captures.push(JSON.parse(content) as Capture);
    }
    return captures.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  // Routes
  async saveRoute(route: Route): Promise<void> {
    const filePath = path.join(this.dataDir, 'routes', `${route.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(route, null, 2));
  }

  async getRoute(id: string): Promise<Route | null> {
    const filePath = path.join(this.dataDir, 'routes', `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Route;
  }

  async listRoutes(): Promise<Route[]> {
    const routesDir = path.join(this.dataDir, 'routes');
    if (!fs.existsSync(routesDir)) {
      return [];
    }
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.json'));
    const routes: Route[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf-8');
      routes.push(JSON.parse(content) as Route);
    }
    return routes;
  }

  async getRouteByName(name: string): Promise<Route | null> {
    const routes = await this.listRoutes();
    return routes.find(r => r.name === name) || null;
  }

  // Execution traces
  async saveExecutionTrace(captureId: string, trace: ExecutionStep[]): Promise<void> {
    const filePath = path.join(this.dataDir, 'executions', `${captureId}-trace.json`);
    fs.writeFileSync(filePath, JSON.stringify(trace, null, 2));
  }

  // Config
  async getConfig(): Promise<Config> {
    const filePath = path.join(this.dataDir, 'config.json');
    if (!fs.existsSync(filePath)) {
      const defaultConfig: Config = {
        authToken: 'dev-token',
        requireApproval: false,
        approvalGuardPrompt: null,
        mastermindRetryAttempts: 3,
      };
      fs.writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Config;
  }

  async saveConfig(config: Config): Promise<void> {
    const filePath = path.join(this.dataDir, 'config.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }

  // Inbox (fallback for failures)
  async appendToInbox(entry: string): Promise<void> {
    const filePath = path.join(this.dataDir, 'slapture-inbox.txt');
    fs.appendFileSync(filePath, `${new Date().toISOString()}: ${entry}\n`);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/storage.test.ts`
Expected: All tests PASS

**Step 5: Add route storage tests**

```typescript
// Add to tests/unit/storage.test.ts after captures describe block

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
```

**Step 6: Run all storage tests**

Run: `pnpm test tests/unit/storage.test.ts`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add storage layer for captures, routes, config"
```

---

## Task 3: Parser Module

**Files:**
- Create: `src/parser/index.ts`
- Create: `tests/unit/parser.test.ts`

**Step 1: Write failing tests for parser**

```typescript
// tests/unit/parser.test.ts
import { describe, it, expect } from 'vitest';
import { Parser } from '../../src/parser/index.js';

describe('Parser', () => {
  const parser = new Parser();

  describe('prefix with colon', () => {
    it('should extract explicit route from "dump: content"', () => {
      const result = parser.parse('dump: this is a test');

      expect(result.explicitRoute).toBe('dump');
      expect(result.payload).toBe('this is a test');
    });

    it('should handle colons in payload', () => {
      const result = parser.parse('note: remember: buy milk');

      expect(result.explicitRoute).toBe('note');
      expect(result.payload).toBe('remember: buy milk');
    });
  });

  describe('hashtag prefix', () => {
    it('should extract route from "#tweet content"', () => {
      const result = parser.parse('#tweet hello world');

      expect(result.explicitRoute).toBe('tweet');
      expect(result.payload).toBe('hello world');
    });
  });

  describe('parenthetical metadata', () => {
    it('should extract source from "(from Bob)"', () => {
      const result = parser.parse('movie reco Terminator 2 (from Bob)');

      expect(result.explicitRoute).toBeNull();
      expect(result.payload).toBe('movie reco Terminator 2');
      expect(result.metadata.source).toBe('Bob');
    });

    it('should handle multiple parentheticals', () => {
      const result = parser.parse('task do thing (urgent) (from Alice)');

      expect(result.payload).toBe('task do thing');
      expect(result.metadata.source).toBe('Alice');
      expect(result.metadata.tags).toContain('urgent');
    });
  });

  describe('implicit structure', () => {
    it('should detect measurement pattern', () => {
      const result = parser.parse('weight 88.2kg');

      expect(result.explicitRoute).toBeNull();
      expect(result.payload).toBe('weight 88.2kg');
      expect(result.metadata.detectedType).toBe('measurement');
    });
  });

  describe('no structure', () => {
    it('should pass through unstructured text', () => {
      const result = parser.parse('just some random text');

      expect(result.explicitRoute).toBeNull();
      expect(result.payload).toBe('just some random text');
      expect(Object.keys(result.metadata)).toHaveLength(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/parser.test.ts`
Expected: FAIL with module not found

**Step 3: Implement Parser**

```typescript
// src/parser/index.ts
import { ParseResult } from '../types.js';

export class Parser {
  parse(raw: string): ParseResult {
    const trimmed = raw.trim();

    // Try prefix with colon: "dump: content"
    const colonMatch = trimmed.match(/^([a-zA-Z][\w-]*?):\s+(.+)$/s);
    if (colonMatch) {
      return {
        explicitRoute: colonMatch[1].toLowerCase(),
        payload: colonMatch[2].trim(),
        metadata: {},
      };
    }

    // Try hashtag prefix: "#tweet content"
    const hashtagMatch = trimmed.match(/^#([a-zA-Z][\w-]*)\s+(.+)$/s);
    if (hashtagMatch) {
      return {
        explicitRoute: hashtagMatch[1].toLowerCase(),
        payload: hashtagMatch[2].trim(),
        metadata: {},
      };
    }

    // Extract parenthetical metadata
    let payload = trimmed;
    const metadata: Record<string, string> = {};

    // Extract (from X) pattern
    const fromMatch = payload.match(/\(from\s+([^)]+)\)/i);
    if (fromMatch) {
      metadata.source = fromMatch[1].trim();
      payload = payload.replace(fromMatch[0], '').trim();
    }

    // Extract other parentheticals as tags
    const tagMatches = payload.matchAll(/\(([^)]+)\)/g);
    const tags: string[] = [];
    for (const match of tagMatches) {
      if (!match[1].toLowerCase().startsWith('from ')) {
        tags.push(match[1].trim());
        payload = payload.replace(match[0], '').trim();
      }
    }
    if (tags.length > 0) {
      metadata.tags = tags.join(',');
    }

    // Clean up multiple spaces
    payload = payload.replace(/\s+/g, ' ').trim();

    // Detect implicit structure
    if (/^\w+\s+[\d.]+\s*(kg|lbs?|lb|g|oz|ml|l|cm|m|ft|in)?$/i.test(payload)) {
      metadata.detectedType = 'measurement';
    }

    return {
      explicitRoute: null,
      payload,
      metadata,
    };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/parser.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add parser with colon prefix, hashtag, and metadata extraction"
```

---

## Task 4: Dispatcher Module

**Files:**
- Create: `src/dispatcher/index.ts`
- Create: `tests/unit/dispatcher.test.ts`

**Step 1: Write failing tests for dispatcher**

```typescript
// tests/unit/dispatcher.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Dispatcher } from '../../src/dispatcher/index.js';
import { Route, ParseResult } from '../../src/types.js';

describe('Dispatcher', () => {
  let dispatcher: Dispatcher;
  const routes: Route[] = [
    {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump to file',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'user',
      lastUsed: null,
    },
    {
      id: 'route-weight',
      name: 'weightlog',
      description: 'Log weight measurements',
      triggers: [
        { type: 'regex', pattern: '^weight\\s+[\\d.]+\\s*(kg|lbs?)?$', priority: 5 },
      ],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'weight.csv' },
      transformScript: null,
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'mastermind',
      lastUsed: null,
    },
  ];

  beforeEach(() => {
    dispatcher = new Dispatcher(routes);
  });

  describe('explicit route matching', () => {
    it('should match explicit route with high confidence', () => {
      const parsed: ParseResult = {
        explicitRoute: 'dump',
        payload: 'test content',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBe('route-dump');
      expect(result.confidence).toBe('high');
    });

    it('should return null for unknown explicit route', () => {
      const parsed: ParseResult = {
        explicitRoute: 'unknown',
        payload: 'test',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBeNull();
      expect(result.reason).toContain('No route named');
    });
  });

  describe('trigger matching', () => {
    it('should match regex trigger with medium confidence', () => {
      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'weight 88.2kg',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBe('route-weight');
      expect(result.confidence).toBe('medium');
    });

    it('should return null when no triggers match', () => {
      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'random unmatched text',
        metadata: {},
      };

      const result = dispatcher.dispatch(parsed);

      expect(result.routeId).toBeNull();
      expect(result.reason).toContain('No matching triggers');
    });
  });

  describe('priority ordering', () => {
    it('should prefer higher priority triggers', () => {
      const routesWithConflict: Route[] = [
        ...routes,
        {
          id: 'route-low',
          name: 'low-priority',
          description: 'Low priority catch-all',
          triggers: [{ type: 'regex', pattern: '.*weight.*', priority: 1 }],
          schema: null,
          recentItems: [],
          destinationType: 'fs',
          destinationConfig: { filePath: 'low.txt' },
          transformScript: null,
          createdAt: '2026-01-21T12:00:00Z',
          createdBy: 'user',
          lastUsed: null,
        },
      ];
      const dispatcherWithConflict = new Dispatcher(routesWithConflict);

      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'weight 88.2kg',
        metadata: {},
      };

      const result = dispatcherWithConflict.dispatch(parsed);

      expect(result.routeId).toBe('route-weight'); // Higher priority
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/dispatcher.test.ts`
Expected: FAIL with module not found

**Step 3: Implement Dispatcher**

```typescript
// src/dispatcher/index.ts
import { Route, ParseResult, DispatchResult } from '../types.js';

export class Dispatcher {
  private routes: Route[];

  constructor(routes: Route[]) {
    this.routes = routes;
  }

  updateRoutes(routes: Route[]): void {
    this.routes = routes;
  }

  dispatch(parsed: ParseResult): DispatchResult {
    // If explicit route specified, look for exact match
    if (parsed.explicitRoute) {
      const route = this.routes.find(
        r => r.name.toLowerCase() === parsed.explicitRoute?.toLowerCase()
      );

      if (route) {
        return {
          routeId: route.id,
          confidence: 'high',
          reason: `Explicit route match: ${route.name}`,
        };
      }

      return {
        routeId: null,
        confidence: null,
        reason: `No route named "${parsed.explicitRoute}"`,
      };
    }

    // Collect all matching triggers with their routes
    const matches: Array<{ route: Route; trigger: Route['triggers'][0] }> = [];

    for (const route of this.routes) {
      for (const trigger of route.triggers) {
        if (this.triggerMatches(trigger, parsed.payload)) {
          matches.push({ route, trigger });
        }
      }
    }

    if (matches.length === 0) {
      return {
        routeId: null,
        confidence: null,
        reason: 'No matching triggers found',
      };
    }

    // Sort by priority (highest first)
    matches.sort((a, b) => b.trigger.priority - a.trigger.priority);

    const best = matches[0];
    const confidence = matches.length === 1 ? 'medium' : 'low';

    return {
      routeId: best.route.id,
      confidence,
      reason: `Matched trigger: ${best.trigger.type}:${best.trigger.pattern}${
        matches.length > 1 ? ` (${matches.length} matches, using highest priority)` : ''
      }`,
    };
  }

  private triggerMatches(trigger: Route['triggers'][0], payload: string): boolean {
    switch (trigger.type) {
      case 'prefix':
        return payload.toLowerCase().startsWith(trigger.pattern.toLowerCase());

      case 'regex':
        try {
          const regex = new RegExp(trigger.pattern, 'i');
          return regex.test(payload);
        } catch {
          return false;
        }

      case 'keyword':
        return payload.toLowerCase().includes(trigger.pattern.toLowerCase());

      case 'semantic':
        // Semantic matching would require LLM - skip in dispatcher
        return false;

      default:
        return false;
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/dispatcher.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add dispatcher with prefix, regex, keyword matching"
```

---

## Task 5: Route Executor (Transform Scripts)

**Files:**
- Create: `src/routes/executor.ts`
- Create: `tests/unit/executor.test.ts`

**Step 1: Write failing tests for executor**

```typescript
// tests/unit/executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RouteExecutor } from '../../src/routes/executor.js';
import { Route } from '../../src/types.js';
import fs from 'fs';
import path from 'path';

const TEST_FILESTORE = './test-filestore';
const TEST_USER = 'testuser';

describe('RouteExecutor', () => {
  let executor: RouteExecutor;

  beforeEach(() => {
    executor = new RouteExecutor(TEST_FILESTORE);
    fs.mkdirSync(path.join(TEST_FILESTORE, TEST_USER), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('text append', () => {
    it('should append text to file', async () => {
      const route: Route = {
        id: 'route-1',
        name: 'dump',
        description: 'Dump text',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'dump.txt' },
        transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'hello world', TEST_USER, {});

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'dump.txt'),
        'utf-8'
      );
      expect(content).toBe('hello world\n');
    });

    it('should append multiple entries', async () => {
      const route: Route = {
        id: 'route-1',
        name: 'dump',
        description: 'Dump text',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'dump.txt' },
        transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'first', TEST_USER, {});
      await executor.execute(route, 'second', TEST_USER, {});

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'dump.txt'),
        'utf-8'
      );
      expect(content).toBe('first\nsecond\n');
    });
  });

  describe('json operations', () => {
    it('should update json map', async () => {
      const route: Route = {
        id: 'route-2',
        name: 'notes',
        description: 'Save notes',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'notes.json' },
        transformScript: `
          let data = {};
          if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          }
          data[timestamp] = payload;
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        `,
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'test note', TEST_USER, {}, '2026-01-21T12:00:00Z');

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'notes.json'),
        'utf-8'
      );
      const data = JSON.parse(content);
      expect(data['2026-01-21T12:00:00Z']).toBe('test note');
    });
  });

  describe('path validation', () => {
    it('should reject paths outside filestore', async () => {
      const route: Route = {
        id: 'route-evil',
        name: 'evil',
        description: 'Try to escape',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: '../../../etc/passwd' },
        transformScript: "fs.writeFileSync(filePath, 'hacked')",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await expect(
        executor.execute(route, 'payload', TEST_USER, {})
      ).rejects.toThrow('Path validation failed');
    });
  });

  describe('metadata access', () => {
    it('should provide metadata to transform script', async () => {
      const route: Route = {
        id: 'route-meta',
        name: 'meta',
        description: 'Use metadata',
        triggers: [],
        schema: null,
        recentItems: [],
        destinationType: 'fs',
        destinationConfig: { filePath: 'meta.txt' },
        transformScript: "fs.writeFileSync(filePath, `${payload} from ${metadata.source}`)",
        createdAt: '2026-01-21T12:00:00Z',
        createdBy: 'user',
        lastUsed: null,
      };

      await executor.execute(route, 'hello', TEST_USER, { source: 'Bob' });

      const content = fs.readFileSync(
        path.join(TEST_FILESTORE, TEST_USER, 'meta.txt'),
        'utf-8'
      );
      expect(content).toBe('hello from Bob');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/executor.test.ts`
Expected: FAIL with module not found

**Step 3: Implement RouteExecutor**

```typescript
// src/routes/executor.ts
import { Route } from '../types.js';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

export interface ExecutionResult {
  success: boolean;
  error?: string;
}

export class RouteExecutor {
  private filestoreRoot: string;

  constructor(filestoreRoot: string = './filestore') {
    this.filestoreRoot = filestoreRoot;
  }

  async execute(
    route: Route,
    payload: string,
    username: string,
    metadata: Record<string, string>,
    timestamp?: string
  ): Promise<ExecutionResult> {
    const userDir = path.join(this.filestoreRoot, username);

    // Ensure user directory exists
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Resolve and validate file path
    const configuredPath = route.destinationConfig.filePath;
    const absolutePath = path.resolve(userDir, configuredPath);
    const normalizedUserDir = path.resolve(userDir);

    // Path traversal check
    if (!absolutePath.startsWith(normalizedUserDir)) {
      throw new Error(`Path validation failed: ${configuredPath} escapes user directory`);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // If no transform script, just write payload
    if (!route.transformScript) {
      fs.writeFileSync(absolutePath, payload);
      return { success: true };
    }

    // Create sandboxed fs that only allows operations within user directory
    const sandboxedFs = this.createSandboxedFs(normalizedUserDir);

    // Execute transform script in vm
    const context = vm.createContext({
      fs: sandboxedFs,
      payload,
      filePath: absolutePath,
      timestamp: timestamp || new Date().toISOString(),
      metadata,
      console: { log: () => {}, error: () => {} }, // Suppress console
      JSON,
    });

    try {
      vm.runInContext(route.transformScript, context, {
        timeout: 5000, // 5 second timeout
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private createSandboxedFs(userDir: string) {
    const validatePath = (p: string) => {
      const resolved = path.resolve(p);
      if (!resolved.startsWith(userDir)) {
        throw new Error(`Path validation failed: access denied outside user directory`);
      }
      return resolved;
    };

    return {
      readFileSync: (p: string, encoding?: string) => {
        return fs.readFileSync(validatePath(p), encoding as BufferEncoding);
      },
      writeFileSync: (p: string, data: string) => {
        const validated = validatePath(p);
        const parentDir = path.dirname(validated);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(validated, data);
      },
      appendFileSync: (p: string, data: string) => {
        const validated = validatePath(p);
        const parentDir = path.dirname(validated);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.appendFileSync(validated, data);
      },
      existsSync: (p: string) => {
        try {
          return fs.existsSync(validatePath(p));
        } catch {
          return false;
        }
      },
      mkdirSync: (p: string, options?: fs.MakeDirectoryOptions) => {
        fs.mkdirSync(validatePath(p), options);
      },
      readdirSync: (p: string) => {
        return fs.readdirSync(validatePath(p));
      },
      unlinkSync: (p: string) => {
        fs.unlinkSync(validatePath(p));
      },
    };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/executor.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add route executor with node:vm sandboxing and path validation"
```

---

## Task 6: Mastermind Integration

**Files:**
- Create: `src/mastermind/index.ts`
- Create: `tests/unit/mastermind.test.ts`

**Step 1: Write failing tests for mastermind**

```typescript
// tests/unit/mastermind.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mastermind } from '../../src/mastermind/index.js';
import { Route, ParseResult, MastermindAction } from '../../src/types.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn(),
    };
  },
}));

describe('Mastermind', () => {
  let mastermind: Mastermind;
  const existingRoutes: Route[] = [
    {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump text to file',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'user',
      lastUsed: null,
    },
  ];

  beforeEach(() => {
    mastermind = new Mastermind('test-api-key');
  });

  describe('prompt building', () => {
    it('should build correct prompt structure', () => {
      const parsed: ParseResult = {
        explicitRoute: null,
        payload: 'weight 88.2kg',
        metadata: { detectedType: 'measurement' },
      };

      const prompt = mastermind.buildPrompt(
        existingRoutes,
        'weight 88.2kg',
        parsed,
        'No matching triggers found'
      );

      expect(prompt).toContain('You are the Slapture Mastermind');
      expect(prompt).toContain('dump');
      expect(prompt).toContain('weight 88.2kg');
      expect(prompt).toContain('No matching triggers found');
    });
  });

  describe('response parsing', () => {
    it('should parse route action', () => {
      const response = JSON.stringify({
        action: 'route',
        routeId: 'route-dump',
        reason: 'This fits the dump route',
      });

      const action = mastermind.parseResponse(response);

      expect(action.action).toBe('route');
      expect(action.routeId).toBe('route-dump');
    });

    it('should parse create action with new route', () => {
      const response = JSON.stringify({
        action: 'create',
        route: {
          name: 'weightlog',
          description: 'Log weight measurements',
          triggers: [
            { type: 'regex', pattern: '^weight\\s+[\\d.]+\\s*(kg|lbs?)?$', priority: 5 },
          ],
          destinationType: 'fs',
          destinationConfig: { filePath: 'weight.csv' },
          transformScript: `
            let lines = [];
            if (fs.existsSync(filePath)) {
              lines = fs.readFileSync(filePath, 'utf-8').trim().split('\\n');
            }
            const match = payload.match(/([\\d.]+)\\s*(kg|lbs?)?/i);
            const value = match[1];
            const unit = match[2] || 'kg';
            lines.push(\`\${timestamp},\${value},\${unit}\`);
            fs.writeFileSync(filePath, lines.join('\\n') + '\\n');
          `,
          schema: 'weight measurement: number with optional unit',
          createdBy: 'mastermind',
        },
        reason: 'Creating new route for weight tracking',
      });

      const action = mastermind.parseResponse(response);

      expect(action.action).toBe('create');
      expect(action.route?.name).toBe('weightlog');
      expect(action.route?.triggers).toHaveLength(1);
    });

    it('should parse clarify action', () => {
      const response = JSON.stringify({
        action: 'clarify',
        question: 'Is this a weight measurement or are you talking about importance?',
        reason: 'Ambiguous input',
      });

      const action = mastermind.parseResponse(response);

      expect(action.action).toBe('clarify');
      expect(action.question).toContain('weight measurement');
    });

    it('should handle malformed JSON gracefully', () => {
      const action = mastermind.parseResponse('not json at all');

      expect(action.action).toBe('inbox');
      expect(action.reason).toContain('Failed to parse');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/mastermind.test.ts`
Expected: FAIL with module not found

**Step 3: Implement Mastermind**

```typescript
// src/mastermind/index.ts
import Anthropic from '@anthropic-ai/sdk';
import { Route, ParseResult, MastermindAction } from '../types.js';

export class Mastermind {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  buildPrompt(
    routes: Route[],
    raw: string,
    parsed: ParseResult,
    dispatcherReason: string
  ): string {
    const routeDescriptions = routes
      .map(r => {
        const triggers = r.triggers
          .map(t => `${t.type}:${t.pattern}`)
          .join(', ');
        const recentExamples = r.recentItems
          .slice(0, 3)
          .map(item => `  - "${item.raw}"`)
          .join('\n');
        return `- **${r.name}**: ${r.description}
  Triggers: ${triggers}
  ${recentExamples ? `Recent:\n${recentExamples}` : ''}`;
      })
      .join('\n\n');

    return `You are the Slapture Mastermind. You handle captures that couldn't be automatically routed.

Current routes:
${routeDescriptions || '(No routes defined yet)'}

Capture to process:
- Raw: "${raw}"
- Parsed payload: "${parsed.payload}"
- Metadata: ${JSON.stringify(parsed.metadata)}
- Dispatcher result: ${dispatcherReason}

Your options:
1. Route to existing: {"action": "route", "routeId": "...", "reason": "..."}
2. Create new route: {"action": "create", "route": {name, description, triggers: [{type, pattern, priority}], destinationType: "fs", destinationConfig: {filePath}, transformScript, schema, createdBy: "mastermind"}, "reason": "..."}
3. Need clarification: {"action": "clarify", "question": "...", "reason": "..."}
4. Send to inbox: {"action": "inbox", "reason": "..."}

For transformScript, you have access to: fs (sandboxed), payload, filePath, timestamp, metadata.
Common patterns:
- Append text: fs.appendFileSync(filePath, payload + '\\n')
- JSON map: read, parse, update, write back
- CSV append: read lines, add new row, write back

Consider alternative interpretations. Only reject alternatives that are clearly absurd.
If the input is ambiguous between reasonable interpretations, choose "clarify".

Respond with JSON only.`;
  }

  async consult(
    routes: Route[],
    raw: string,
    parsed: ParseResult,
    dispatcherReason: string
  ): Promise<MastermindAction> {
    const prompt = this.buildPrompt(routes, raw, parsed, dispatcherReason);

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return {
          action: 'inbox',
          reason: 'Unexpected response type from API',
        };
      }

      return this.parseResponse(content.text);
    } catch (error) {
      return {
        action: 'inbox',
        reason: `API error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  parseResponse(responseText: string): MastermindAction {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          action: 'inbox',
          reason: `Failed to parse response: no JSON found`,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.action || !['route', 'create', 'clarify', 'inbox'].includes(parsed.action)) {
        return {
          action: 'inbox',
          reason: `Invalid action in response: ${parsed.action}`,
        };
      }

      return parsed as MastermindAction;
    } catch (error) {
      return {
        action: 'inbox',
        reason: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/mastermind.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add mastermind with Anthropic API integration and prompt building"
```

---

## Task 7: Capture Pipeline (Orchestration)

**Files:**
- Create: `src/pipeline/index.ts`
- Create: `tests/unit/pipeline.test.ts`

**Step 1: Write failing tests for pipeline**

```typescript
// tests/unit/pipeline.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapturePipeline } from '../../src/pipeline/index.js';
import { Storage } from '../../src/storage/index.js';
import { Route } from '../../src/types.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-pipeline-data';
const TEST_FILESTORE = './test-pipeline-filestore';

// Mock Mastermind
vi.mock('../../src/mastermind/index.js', () => ({
  Mastermind: class MockMastermind {
    async consult() {
      return {
        action: 'create',
        route: {
          name: 'newroute',
          description: 'Auto-created route',
          triggers: [{ type: 'keyword', pattern: 'test', priority: 5 }],
          destinationType: 'fs',
          destinationConfig: { filePath: 'new.txt' },
          transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
          schema: null,
          createdBy: 'mastermind',
        },
        reason: 'Created new route',
      };
    }
  },
}));

describe('CapturePipeline', () => {
  let pipeline: CapturePipeline;
  let storage: Storage;

  beforeEach(async () => {
    storage = new Storage(TEST_DATA_DIR);

    // Create test routes
    const dumpRoute: Route = {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump text',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-01-21T12:00:00Z',
      createdBy: 'user',
      lastUsed: null,
    };
    await storage.saveRoute(dumpRoute);

    pipeline = new CapturePipeline(storage, TEST_FILESTORE, 'test-api-key');
  });

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('full pipeline', () => {
    it('should process capture with explicit route', async () => {
      const result = await pipeline.process('dump: hello world', 'testuser');

      expect(result.capture.executionResult).toBe('success');
      expect(result.capture.routeFinal).toBe('route-dump');

      const fileContent = fs.readFileSync(
        `${TEST_FILESTORE}/testuser/dump.txt`,
        'utf-8'
      );
      expect(fileContent).toBe('hello world\n');
    });

    it('should save capture to storage', async () => {
      const result = await pipeline.process('dump: test', 'testuser');

      const saved = await storage.getCapture(result.capture.id);
      expect(saved).not.toBeNull();
      expect(saved?.raw).toBe('dump: test');
    });

    it('should record execution trace', async () => {
      const result = await pipeline.process('dump: test', 'testuser');

      expect(result.capture.executionTrace.length).toBeGreaterThan(0);
      expect(result.capture.executionTrace.some(s => s.step === 'parse')).toBe(true);
      expect(result.capture.executionTrace.some(s => s.step === 'dispatch')).toBe(true);
      expect(result.capture.executionTrace.some(s => s.step === 'execute')).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/pipeline.test.ts`
Expected: FAIL with module not found

**Step 3: Implement CapturePipeline**

```typescript
// src/pipeline/index.ts
import { v4 as uuidv4 } from 'uuid';
import { Capture, Route, ExecutionStep, ParseResult, DispatchResult } from '../types.js';
import { Storage } from '../storage/index.js';
import { Parser } from '../parser/index.js';
import { Dispatcher } from '../dispatcher/index.js';
import { RouteExecutor } from '../routes/executor.js';
import { Mastermind } from '../mastermind/index.js';

export interface PipelineResult {
  capture: Capture;
  needsClarification?: string;
}

export class CapturePipeline {
  private storage: Storage;
  private parser: Parser;
  private dispatcher: Dispatcher;
  private executor: RouteExecutor;
  private mastermind: Mastermind;
  private codeVersion: string;

  constructor(
    storage: Storage,
    filestoreRoot: string,
    apiKey: string,
    codeVersion: string = 'dev'
  ) {
    this.storage = storage;
    this.parser = new Parser();
    this.dispatcher = new Dispatcher([]);
    this.executor = new RouteExecutor(filestoreRoot);
    this.mastermind = new Mastermind(apiKey);
    this.codeVersion = codeVersion;
  }

  async process(raw: string, username: string): Promise<PipelineResult> {
    const capture: Capture = {
      id: uuidv4(),
      raw,
      timestamp: new Date().toISOString(),
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

    try {
      // Load routes and update dispatcher
      const routes = await this.storage.listRoutes();
      this.dispatcher.updateRoutes(routes);

      // Step 1: Parse
      const parseStart = Date.now();
      const parsed = this.parser.parse(raw);
      capture.parsed = parsed;
      this.addTrace(capture, 'parse', raw, parsed, parseStart);

      // Step 2: Dispatch
      const dispatchStart = Date.now();
      const dispatchResult = this.dispatcher.dispatch(parsed);
      capture.routeProposed = dispatchResult.routeId;
      capture.routeConfidence = dispatchResult.confidence;
      this.addTrace(capture, 'dispatch', parsed, dispatchResult, dispatchStart);

      // Step 3: Handle dispatch result
      let route: Route | null = null;

      if (dispatchResult.routeId) {
        route = await this.storage.getRoute(dispatchResult.routeId);
      }

      // If no route matched, consult Mastermind
      if (!route) {
        const mastermindStart = Date.now();
        const action = await this.mastermind.consult(
          routes,
          raw,
          parsed,
          dispatchResult.reason
        );
        this.addTrace(capture, 'mastermind', { raw, parsed, reason: dispatchResult.reason }, action, mastermindStart);

        if (action.action === 'route' && action.routeId) {
          route = await this.storage.getRoute(action.routeId);
        } else if (action.action === 'create' && action.route) {
          // Create new route
          const newRoute: Route = {
            ...action.route,
            id: `route-${uuidv4()}`,
            createdAt: new Date().toISOString(),
            lastUsed: null,
            recentItems: [],
          };
          await this.storage.saveRoute(newRoute);
          route = newRoute;

          // Update dispatcher with new route
          this.dispatcher.updateRoutes([...routes, newRoute]);
        } else if (action.action === 'clarify') {
          capture.executionResult = 'pending';
          capture.verificationState = 'pending';
          await this.storage.saveCapture(capture);
          return { capture, needsClarification: action.question };
        } else {
          // Send to inbox
          await this.storage.appendToInbox(`${capture.id}: ${raw} - ${action.reason}`);
          capture.executionResult = 'rejected';
          capture.verificationState = 'ai_uncertain';
          await this.storage.saveCapture(capture);
          return { capture };
        }
      }

      // Step 4: Execute
      if (route) {
        const executeStart = Date.now();
        const execResult = await this.executor.execute(
          route,
          parsed.payload,
          username,
          parsed.metadata,
          capture.timestamp
        );
        this.addTrace(capture, 'execute', { route: route.id, payload: parsed.payload }, execResult, executeStart);

        if (execResult.success) {
          capture.routeFinal = route.id;
          capture.executionResult = 'success';
          capture.verificationState = capture.routeConfidence === 'high' ? 'ai_certain' : 'ai_uncertain';

          // Update route's lastUsed and recentItems
          route.lastUsed = capture.timestamp;
          route.recentItems = [
            { captureId: capture.id, raw, timestamp: capture.timestamp, wasCorrect: true },
            ...route.recentItems.slice(0, 4),
          ];
          await this.storage.saveRoute(route);
        } else {
          capture.executionResult = 'failed';
          capture.verificationState = 'failed';
        }
      }

      await this.storage.saveCapture(capture);
      return { capture };

    } catch (error) {
      capture.executionResult = 'failed';
      capture.verificationState = 'failed';
      this.addTrace(capture, 'execute', {}, { error: String(error) }, Date.now());
      await this.storage.saveCapture(capture);
      return { capture };
    }
  }

  private addTrace(
    capture: Capture,
    step: ExecutionStep['step'],
    input: unknown,
    output: unknown,
    startTime: number
  ): void {
    capture.executionTrace.push({
      step,
      timestamp: new Date().toISOString(),
      input,
      output,
      codeVersion: this.codeVersion,
      durationMs: Date.now() - startTime,
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/pipeline.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add capture pipeline orchestrating parse, dispatch, mastermind, execute"
```

---

## Task 8: HTTP Server

**Files:**
- Create: `src/server/index.ts`
- Modify: `src/index.ts`
- Create: `tests/unit/server.test.ts`

**Step 1: Write failing tests for server**

```typescript
// tests/unit/server.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../src/server/index.js';
import { Storage } from '../../src/storage/index.js';
import fs from 'fs';

const TEST_DATA_DIR = './test-server-data';
const TEST_FILESTORE = './test-server-filestore';

describe('HTTP Server', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let storage: Storage;

  beforeAll(async () => {
    storage = new Storage(TEST_DATA_DIR);
    await storage.saveConfig({
      authToken: 'test-token',
      requireApproval: false,
      approvalGuardPrompt: null,
      mastermindRetryAttempts: 3,
    });

    server = await buildServer(storage, TEST_FILESTORE, 'test-api-key');
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(TEST_FILESTORE, { recursive: true, force: true });
  });

  describe('POST /capture', () => {
    it('should require auth token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/capture',
        payload: { text: 'test' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should accept capture with valid token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/capture?token=test-token',
        payload: { text: 'dump: hello' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.captureId).toBeDefined();
    });
  });

  describe('GET /status/:captureId', () => {
    it('should return capture status', async () => {
      // First create a capture
      const createResponse = await server.inject({
        method: 'POST',
        url: '/capture?token=test-token',
        payload: { text: 'dump: test status' },
      });
      const { captureId } = JSON.parse(createResponse.body);

      // Then get its status
      const statusResponse = await server.inject({
        method: 'GET',
        url: `/status/${captureId}?token=test-token`,
      });

      expect(statusResponse.statusCode).toBe(200);
      const status = JSON.parse(statusResponse.body);
      expect(status.id).toBe(captureId);
    });

    it('should return 404 for unknown capture', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/status/nonexistent?token=test-token',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /routes', () => {
    it('should list routes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/routes?token=test-token',
      });

      expect(response.statusCode).toBe(200);
      const routes = JSON.parse(response.body);
      expect(Array.isArray(routes)).toBe(true);
    });
  });

  describe('GET /captures', () => {
    it('should list recent captures', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/captures?token=test-token',
      });

      expect(response.statusCode).toBe(200);
      const captures = JSON.parse(response.body);
      expect(Array.isArray(captures)).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/server.test.ts`
Expected: FAIL with module not found

**Step 3: Implement HTTP server**

```typescript
// src/server/index.ts
import Fastify, { FastifyInstance } from 'fastify';
import { Storage } from '../storage/index.js';
import { CapturePipeline } from '../pipeline/index.js';
import path from 'path';
import fs from 'fs';

export async function buildServer(
  storage: Storage,
  filestoreRoot: string,
  apiKey: string
): Promise<FastifyInstance> {
  const server = Fastify({ logger: true });

  const pipeline = new CapturePipeline(storage, filestoreRoot, apiKey);

  // Auth hook
  server.addHook('onRequest', async (request, reply) => {
    // Skip auth for widget
    if (request.url === '/widget' || request.url.startsWith('/widget/')) {
      return;
    }

    const token = (request.query as Record<string, string>).token;
    const config = await storage.getConfig();

    if (token !== config.authToken) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // POST /capture - Submit a new capture
  server.post<{
    Querystring: { token: string };
    Body: { text: string; username?: string };
  }>('/capture', async (request, reply) => {
    const { text, username = 'default' } = request.body;

    if (!text || typeof text !== 'string') {
      return reply.code(400).send({ error: 'text is required' });
    }

    const result = await pipeline.process(text, username);

    return {
      captureId: result.capture.id,
      status: result.capture.executionResult,
      routeFinal: result.capture.routeFinal,
      needsClarification: result.needsClarification,
    };
  });

  // GET /status/:captureId - Get capture status
  server.get<{
    Params: { captureId: string };
    Querystring: { token: string };
  }>('/status/:captureId', async (request, reply) => {
    const { captureId } = request.params;

    const capture = await storage.getCapture(captureId);
    if (!capture) {
      return reply.code(404).send({ error: 'Capture not found' });
    }

    return capture;
  });

  // GET /routes - List all routes
  server.get('/routes', async () => {
    return storage.listRoutes();
  });

  // GET /captures - List recent captures
  server.get<{
    Querystring: { token: string; limit?: string };
  }>('/captures', async (request) => {
    const limit = parseInt(request.query.limit || '50', 10);
    return storage.listCaptures(limit);
  });

  // GET /widget - Serve web widget
  server.get('/widget', async (request, reply) => {
    const widgetPath = path.join(import.meta.dirname, '..', 'widget', 'index.html');

    if (!fs.existsSync(widgetPath)) {
      return reply.code(404).send('Widget not found');
    }

    const html = fs.readFileSync(widgetPath, 'utf-8');
    reply.type('text/html').send(html);
  });

  return server;
}
```

**Step 4: Update src/index.ts to start server**

```typescript
// src/index.ts
import { buildServer } from './server/index.js';
import { Storage } from './storage/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const FILESTORE_DIR = process.env.FILESTORE_DIR || './filestore';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const storage = new Storage(DATA_DIR);
  const server = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY);

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Slapture server running on http://localhost:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
```

**Step 5: Run tests to verify they pass**

Run: `pnpm test tests/unit/server.test.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add HTTP server with capture, status, routes, captures endpoints"
```

---

## Task 9: Web Widget

**Files:**
- Create: `src/widget/index.html`

**Step 1: Create widget HTML**

```html
<!-- src/widget/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slapture</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      width: 100%;
      max-width: 500px;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 20px;
      color: #333;
    }
    .input-group {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    input[type="text"] {
      flex: 1;
      padding: 12px 16px;
      font-size: 16px;
      border: 2px solid #ddd;
      border-radius: 8px;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="text"]:focus {
      border-color: #007aff;
    }
    button {
      padding: 12px 24px;
      font-size: 16px;
      background: #007aff;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #0056b3;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .status {
      padding: 16px;
      background: white;
      border-radius: 8px;
      border: 1px solid #ddd;
    }
    .status.hidden {
      display: none;
    }
    .status-step {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      color: #666;
    }
    .status-step.active {
      color: #007aff;
      font-weight: 500;
    }
    .status-step.done {
      color: #28a745;
    }
    .status-step.error {
      color: #dc3545;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #ddd;
      border-top-color: #007aff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .check {
      color: #28a745;
    }
    .error-icon {
      color: #dc3545;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Slapture</h1>

    <div class="input-group">
      <input
        type="text"
        id="captureInput"
        placeholder="Enter capture (e.g., dump: hello world)"
        autofocus
      >
      <button id="submitBtn" onclick="submitCapture()">Send</button>
    </div>

    <div id="status" class="status hidden">
      <div id="step-parse" class="status-step">
        <span class="icon"></span>
        <span>Parsing...</span>
      </div>
      <div id="step-dispatch" class="status-step">
        <span class="icon"></span>
        <span>Matching route...</span>
      </div>
      <div id="step-mastermind" class="status-step" style="display: none;">
        <span class="icon"></span>
        <span>Analyzing...</span>
      </div>
      <div id="step-execute" class="status-step">
        <span class="icon"></span>
        <span>Executing...</span>
      </div>
      <div id="step-result" class="status-step">
        <span class="icon"></span>
        <span class="result-text"></span>
      </div>
    </div>
  </div>

  <script>
    const API_TOKEN = new URLSearchParams(window.location.search).get('token') || 'dev-token';

    const input = document.getElementById('captureInput');
    const submitBtn = document.getElementById('submitBtn');
    const statusDiv = document.getElementById('status');

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitCapture();
    });

    async function submitCapture() {
      const text = input.value.trim();
      if (!text) return;

      submitBtn.disabled = true;
      statusDiv.classList.remove('hidden');
      resetStatus();

      try {
        // Submit capture
        setStepActive('step-parse');
        const response = await fetch(`/capture?token=${API_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          throw new Error('Failed to submit capture');
        }

        const { captureId } = await response.json();
        setStepDone('step-parse');

        // Poll for status
        await pollStatus(captureId);

        // Clear input on success
        input.value = '';

      } catch (error) {
        setStepError('step-result', error.message);
      } finally {
        submitBtn.disabled = false;
      }
    }

    async function pollStatus(captureId) {
      const maxAttempts = 30;
      let attempts = 0;

      while (attempts < maxAttempts) {
        const response = await fetch(`/status/${captureId}?token=${API_TOKEN}`);
        const capture = await response.json();

        // Update UI based on execution trace
        const trace = capture.executionTrace || [];

        if (trace.some(t => t.step === 'parse')) {
          setStepDone('step-parse');
        }

        if (trace.some(t => t.step === 'dispatch')) {
          setStepActive('step-dispatch');
          const dispatchStep = trace.find(t => t.step === 'dispatch');
          if (dispatchStep?.output?.routeId) {
            document.querySelector('#step-dispatch span:last-child').textContent =
              `Matched: ${dispatchStep.output.routeId}`;
          }
          setStepDone('step-dispatch');
        }

        if (trace.some(t => t.step === 'mastermind')) {
          document.getElementById('step-mastermind').style.display = 'flex';
          setStepActive('step-mastermind');
          const mmStep = trace.find(t => t.step === 'mastermind');
          if (mmStep?.output?.action === 'create') {
            document.querySelector('#step-mastermind span:last-child').textContent =
              'Creating new route...';
          }
          setStepDone('step-mastermind');
        }

        if (trace.some(t => t.step === 'execute')) {
          setStepActive('step-execute');
        }

        // Check final status
        if (capture.executionResult === 'success') {
          setStepDone('step-execute');
          setStepDone('step-result', `✓ Sent to ${capture.routeFinal || 'destination'}`);
          return;
        } else if (capture.executionResult === 'failed') {
          setStepError('step-execute');
          setStepError('step-result', '✗ Failed');
          return;
        } else if (capture.executionResult === 'rejected') {
          setStepDone('step-execute');
          setStepDone('step-result', '→ Sent to inbox');
          return;
        }

        attempts++;
        await new Promise(r => setTimeout(r, 500));
      }

      setStepError('step-result', 'Timeout waiting for result');
    }

    function resetStatus() {
      ['step-parse', 'step-dispatch', 'step-mastermind', 'step-execute', 'step-result'].forEach(id => {
        const el = document.getElementById(id);
        el.className = 'status-step';
        el.querySelector('.icon').innerHTML = '';
        if (id === 'step-mastermind') el.style.display = 'none';
      });
      document.querySelector('#step-dispatch span:last-child').textContent = 'Matching route...';
      document.querySelector('#step-mastermind span:last-child').textContent = 'Analyzing...';
      document.querySelector('#step-result .result-text').textContent = '';
    }

    function setStepActive(stepId) {
      const el = document.getElementById(stepId);
      el.className = 'status-step active';
      el.querySelector('.icon').innerHTML = '<div class="spinner"></div>';
    }

    function setStepDone(stepId, text) {
      const el = document.getElementById(stepId);
      el.className = 'status-step done';
      el.querySelector('.icon').innerHTML = '✓';
      if (text) {
        el.querySelector('span:last-child').textContent = text;
      }
    }

    function setStepError(stepId, text) {
      const el = document.getElementById(stepId);
      el.className = 'status-step error';
      el.querySelector('.icon').innerHTML = '✗';
      if (text) {
        el.querySelector('span:last-child').textContent = text;
      }
    }
  </script>
</body>
</html>
```

**Step 2: Verify widget is served correctly**

Run: `pnpm build && ANTHROPIC_API_KEY=test pnpm start &`

Then visit http://localhost:3000/widget?token=dev-token

Expected: Widget loads with input field and send button

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add web widget with progressive status updates"
```

---

## Task 10: Seed Routes for Testing

**Files:**
- Create: `scripts/seed-routes.ts`

**Step 1: Create seed script**

```typescript
// scripts/seed-routes.ts
import { Storage } from '../src/storage/index.js';
import { Route } from '../src/types.js';

async function seed() {
  const storage = new Storage('./data');

  const routes: Route[] = [
    {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump raw text to a file',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    },
    {
      id: 'route-note',
      name: 'note',
      description: 'Save notes to JSON file',
      triggers: [{ type: 'prefix', pattern: 'note', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'notes.json' },
      transformScript: `
        let data = {};
        if (fs.existsSync(filePath)) {
          data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        data[timestamp] = payload;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      `,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    },
  ];

  for (const route of routes) {
    await storage.saveRoute(route);
    console.log(`Created route: ${route.name}`);
  }

  // Create default config
  await storage.saveConfig({
    authToken: 'dev-token',
    requireApproval: false,
    approvalGuardPrompt: null,
    mastermindRetryAttempts: 3,
  });
  console.log('Created config');

  console.log('Seeding complete!');
}

seed().catch(console.error);
```

**Step 2: Add seed script to package.json**

Add to scripts section:
```json
"seed": "tsx scripts/seed-routes.ts"
```

**Step 3: Install tsx for running TypeScript scripts**

Run: `pnpm add -D tsx`

**Step 4: Run seed script**

Run: `pnpm seed`
Expected: Routes and config created in ./data/

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add seed script for initial routes and config"
```

---

## Task 11: Playwright E2E Tests

**Files:**
- Create: `tests/e2e/capture.spec.ts`

**Step 1: Install Playwright browsers**

Run: `pnpm exec playwright install`

**Step 2: Create E2E test file**

```typescript
// tests/e2e/capture.spec.ts
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const TOKEN = 'dev-token';
const FILESTORE = './filestore/default';

test.describe('Example Set A: Basic routing', () => {
  test.beforeEach(async () => {
    // Clean filestore
    if (fs.existsSync(FILESTORE)) {
      fs.rmSync(FILESTORE, { recursive: true, force: true });
    }
    fs.mkdirSync(FILESTORE, { recursive: true });
  });

  test('dump: prefix routes to dump.txt', async ({ request }) => {
    const response = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: this is a test' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('success');

    // Verify file was written
    const content = fs.readFileSync(path.join(FILESTORE, 'dump.txt'), 'utf-8');
    expect(content).toContain('this is a test');
  });

  test('note: prefix routes to notes.json', async ({ request }) => {
    const response = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'note: remember to check logs' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('success');

    // Verify JSON was written
    const content = fs.readFileSync(path.join(FILESTORE, 'notes.json'), 'utf-8');
    const data = JSON.parse(content);
    const values = Object.values(data);
    expect(values).toContain('remember to check logs');
  });
});

test.describe('Example Set D: Progressive UI status', () => {
  test('widget shows status updates for dump capture', async ({ page }) => {
    await page.goto(`/widget?token=${TOKEN}`);

    // Enter capture text
    await page.fill('input#captureInput', 'dump: test from playwright');
    await page.click('button#submitBtn');

    // Wait for success status
    await expect(page.locator('#step-result')).toContainText('✓', { timeout: 10000 });
    await expect(page.locator('#step-result')).toContainText('Sent to');
  });
});

test.describe('Example Set E: Execution failure', () => {
  test('captures failure state for invalid route', async ({ request }) => {
    // This would require setting up a route that fails
    // For now, test the API returns proper error structure
    const response = await request.get(`/status/nonexistent?token=${TOKEN}`);
    expect(response.status()).toBe(404);
  });
});
```

**Step 3: Run E2E tests**

First start the server in another terminal:
```bash
ANTHROPIC_API_KEY=your-key pnpm start
```

Then run tests:
```bash
pnpm test:e2e
```

Expected: Tests pass (some may need real API key for Mastermind tests)

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Playwright E2E tests for Example Sets A, D, E"
```

---

## Task 12: Final Integration and Cleanup

**Step 1: Verify all unit tests pass**

Run: `pnpm test`
Expected: All unit tests PASS

**Step 2: Build and verify no TypeScript errors**

Run: `pnpm build`
Expected: No errors

**Step 3: Update STATE.md to reflect completion**

Mark all Phase 1 items as complete in STATE.md.

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete Phase 1 implementation"
```

---

## Summary

After completing all tasks, Phase 1 should have:

1. **Storage layer** - File-based CRUD for captures, routes, config
2. **Parser** - Extracts explicit routes, hashtags, metadata
3. **Dispatcher** - Matches triggers by prefix, regex, keyword
4. **Route Executor** - Runs transformScripts in node:vm with sandboxed fs
5. **Mastermind** - Anthropic API integration for novel inputs
6. **Capture Pipeline** - Orchestrates the full flow
7. **HTTP Server** - Fastify with /capture, /status, /routes, /captures, /widget
8. **Web Widget** - Clean UI with progressive status updates
9. **Tests** - Unit tests for each module, Playwright E2E tests

Run `pnpm seed` to set up initial routes, then `ANTHROPIC_API_KEY=... pnpm start` to run the server.
