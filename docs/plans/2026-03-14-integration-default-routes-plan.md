# Integration Default Routes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrations can declare default routes that auto-install on OAuth connect, with state tracking and dashboard UI for restore/re-add.

**Architecture:** `DefaultRouteTemplate` on `Integration` type, a new `src/integrations/default-routes.ts` module with install/status/restore logic, hooks in OAuth callbacks, and dashboard UI on the auth page.

**Tech Stack:** TypeScript, Hono (server), server-rendered HTML (dashboard), vitest (tests)

**Spec:** `docs/plans/2026-03-14-integration-default-routes-design.md`

---

## Chunk 1: Types, Core Logic, and Tests

### Task 1: Add types to `src/types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `DefaultRouteTemplate` interface**

Add after the `Integration` interface (line ~287):

```typescript
export interface DefaultRouteTemplate {
  key: string;
  name: string;
  description: string;
  triggers: Array<{ pattern: string; priority: number }>;
  destinationType: Route['destinationType'];
  destinationConfig: Route['destinationConfig'];
  transformScript: string | null;
}
```

- [ ] **Step 2: Add `defaultRoutes` to `Integration`**

Add optional field to the `Integration` interface:

```typescript
export interface Integration {
  id: string;
  name: string;
  purpose: string;
  authType: 'oauth' | 'api-key' | 'none';
  defaultRoutes?: DefaultRouteTemplate[];  // NEW
}
```

- [ ] **Step 3: Add `defaultSource` to `Route` and extend `createdBy`**

On `Route` (line ~122), change `createdBy` and add `defaultSource`:

```typescript
  createdBy: 'user' | 'mastermind' | 'integration';

  /** Tags routes created from integration defaults for state tracking */
  defaultSource?: {
    integrationId: string;
    defaultKey: string;
    templateHash: string;
  };
```

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Clean compile

- [ ] **Step 5: Commit**

```
feat: add DefaultRouteTemplate type, defaultSource on Route, integration createdBy
```

---

### Task 2: Add intend default route to registry

**Files:**
- Modify: `src/integrations/registry.ts`

- [ ] **Step 1: Add `defaultRoutes` to intend's integration entry**

```typescript
{
  id: 'intend',
  name: 'intend.do',
  purpose: 'Track daily intentions, todos, and goals',
  authType: 'oauth',
  defaultRoutes: [
    {
      key: 'intend-format',
      name: 'intend',
      description: 'Intentions in intend.do format (e.g. "1) do laundry", "&) random task")',
      triggers: [{
        pattern: '^[^\\d\\sA-Za-z)]{0,3}(?:(?:\\d|[A-Z]{2})(?:,(?:\\d|[A-Z]{2}))*)?[^\\d\\sA-Z)]{0,3}(?:\\)+|//)\\s+.+',
        priority: 10,
      }],
      destinationType: 'intend',
      destinationConfig: { baseUrl: '' },  // intend executor ignores this (gets baseUrl from tokens)
      transformScript: null,
    },
  ],
},
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm build`

- [ ] **Step 3: Commit**

```
feat: add intend-format default route to integration registry
```

---

### Task 3: Create `src/integrations/default-routes.ts` with tests

**Files:**
- Create: `src/integrations/default-routes.ts`
- Create: `tests/integrations/default-routes.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/integrations/default-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeTemplateHash,
  computeRouteHash,
  installDefaultRoutes,
  getDefaultRouteStatuses,
  restoreDefaultRoute,
} from '../../src/integrations/default-routes';
import type { Route } from '../../src/types';

// Inline the intend template for test assertions
const INTEND_TEMPLATE = {
  key: 'intend-format',
  name: 'intend',
  description: 'Intentions in intend.do format (e.g. "1) do laundry", "&) random task")',
  triggers: [{
    pattern: '^[^\\d\\sA-Za-z)]{0,3}(?:(?:\\d|[A-Z]{2})(?:,(?:\\d|[A-Z]{2}))*)?[^\\d\\sA-Z)]{0,3}(?:\\)+|//)\\s+.+',
    priority: 10,
  }],
  destinationType: 'intend' as const,
  destinationConfig: { baseUrl: '' },
  transformScript: null,
};

function makeStorage(routes: Route[] = []) {
  return {
    listRoutes: vi.fn().mockResolvedValue(routes),
    saveRoute: vi.fn().mockResolvedValue(undefined),
    // other methods not needed
  };
}

describe('computeTemplateHash', () => {
  it('should return consistent hash for same template', () => {
    const h1 = computeTemplateHash(INTEND_TEMPLATE);
    const h2 = computeTemplateHash(INTEND_TEMPLATE);
    expect(h1).toBe(h2);
  });

  it('should return different hash when trigger pattern changes', () => {
    const modified = {
      ...INTEND_TEMPLATE,
      triggers: [{ pattern: 'different', priority: 10 }],
    };
    expect(computeTemplateHash(INTEND_TEMPLATE)).not.toBe(computeTemplateHash(modified));
  });

  it('should return different hash when destinationConfig changes', () => {
    const modified = {
      ...INTEND_TEMPLATE,
      destinationConfig: { filePath: 'foo.csv' },
    };
    expect(computeTemplateHash(INTEND_TEMPLATE)).not.toBe(computeTemplateHash(modified));
  });

  it('should ignore name and description changes', () => {
    const modified = {
      ...INTEND_TEMPLATE,
      name: 'different-name',
      description: 'different description',
    };
    expect(computeTemplateHash(INTEND_TEMPLATE)).toBe(computeTemplateHash(modified));
  });
});

describe('computeRouteHash', () => {
  it('should match computeTemplateHash for equivalent route', () => {
    const route = {
      triggers: [{ type: 'regex' as const, pattern: INTEND_TEMPLATE.triggers[0].pattern, priority: 10 }],
      destinationConfig: { baseUrl: '' },
    } as Route;
    expect(computeRouteHash(route)).toBe(computeTemplateHash(INTEND_TEMPLATE));
  });

  it('should differ when triggers change', () => {
    const route = {
      triggers: [{ type: 'regex' as const, pattern: 'different', priority: 10 }],
      destinationConfig: { baseUrl: '' },
    } as Route;
    expect(computeRouteHash(route)).not.toBe(computeTemplateHash(INTEND_TEMPLATE));
  });

  it('should ignore trigger stats and fireCount', () => {
    const route = {
      triggers: [{
        type: 'regex' as const,
        pattern: INTEND_TEMPLATE.triggers[0].pattern,
        priority: 10,
        fireCount: 42,
        stats: { totalFires: 42, lastFired: '2026-01-01', validationResults: {} },
      }],
      destinationConfig: { baseUrl: '' },
    } as Route;
    expect(computeRouteHash(route)).toBe(computeTemplateHash(INTEND_TEMPLATE));
  });
});

describe('installDefaultRoutes', () => {
  it('should create route when none exists', async () => {
    const storage = makeStorage([]);
    const count = await installDefaultRoutes('intend', storage as any);

    expect(count).toBe(1);
    expect(storage.saveRoute).toHaveBeenCalledTimes(1);

    const saved = storage.saveRoute.mock.calls[0][0] as Route;
    expect(saved.name).toBe('intend');
    expect(saved.destinationType).toBe('intend');
    expect(saved.createdBy).toBe('integration');
    expect(saved.defaultSource).toEqual({
      integrationId: 'intend',
      defaultKey: 'intend-format',
      templateHash: computeTemplateHash(INTEND_TEMPLATE),
    });
    expect(saved.triggers).toHaveLength(1);
    expect(saved.triggers[0].type).toBe('regex');
    expect(saved.triggers[0].status).toBe('live');
  });

  it('should skip when default route already exists', async () => {
    const existing: Partial<Route> = {
      id: 'existing-id',
      name: 'intend',
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: computeTemplateHash(INTEND_TEMPLATE),
      },
    };
    const storage = makeStorage([existing as Route]);
    const count = await installDefaultRoutes('intend', storage as any);

    expect(count).toBe(0);
    expect(storage.saveRoute).not.toHaveBeenCalled();
  });

  it('should return 0 for integration with no default routes', async () => {
    const storage = makeStorage([]);
    const count = await installDefaultRoutes('sheets', storage as any);
    expect(count).toBe(0);
  });
});

describe('getDefaultRouteStatuses', () => {
  it('should return "deleted" when no matching route exists', async () => {
    const storage = makeStorage([]);
    const statuses = await getDefaultRouteStatuses('intend', storage as any);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('deleted');
    expect(statuses[0].template.key).toBe('intend-format');
    expect(statuses[0].existingRouteId).toBeUndefined();
  });

  it('should return "active" when route hash matches stored templateHash', async () => {
    // The stored templateHash should match computeRouteHash of the unmodified route
    const existing: Partial<Route> = {
      id: 'route-123',
      name: 'intend',
      triggers: [{ type: 'regex', pattern: INTEND_TEMPLATE.triggers[0].pattern, priority: 10 }],
      destinationConfig: { baseUrl: '' },
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: computeTemplateHash(INTEND_TEMPLATE),
      },
    };
    const storage = makeStorage([existing as Route]);
    const statuses = await getDefaultRouteStatuses('intend', storage as any);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('active');
    expect(statuses[0].existingRouteId).toBe('route-123');
  });

  it('should return "modified" when route has different hash', async () => {
    const existing: Partial<Route> = {
      id: 'route-123',
      name: 'intend',
      triggers: [{ type: 'regex', pattern: 'custom-pattern', priority: 10 }],
      destinationConfig: { baseUrl: '' },  // intend executor ignores this (gets baseUrl from tokens)
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: computeTemplateHash(INTEND_TEMPLATE), // original hash at install
      },
    };
    const storage = makeStorage([existing as Route]);
    const statuses = await getDefaultRouteStatuses('intend', storage as any);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].state).toBe('modified');
  });

  it('should return empty array for integration with no defaults', async () => {
    const storage = makeStorage([]);
    const statuses = await getDefaultRouteStatuses('sheets', storage as any);
    expect(statuses).toEqual([]);
  });
});

describe('restoreDefaultRoute', () => {
  it('should create new route when state is deleted', async () => {
    const storage = makeStorage([]);
    await restoreDefaultRoute('intend', 'intend-format', storage as any);

    expect(storage.saveRoute).toHaveBeenCalledTimes(1);
    const saved = storage.saveRoute.mock.calls[0][0] as Route;
    expect(saved.name).toBe('intend');
    expect(saved.createdBy).toBe('integration');
  });

  it('should overwrite existing route when state is modified', async () => {
    const existing: Partial<Route> = {
      id: 'route-123',
      name: 'intend-custom',
      triggers: [{ type: 'regex', pattern: 'custom', priority: 5 }],
      destinationConfig: { baseUrl: '' },  // intend executor ignores this (gets baseUrl from tokens)
      defaultSource: {
        integrationId: 'intend',
        defaultKey: 'intend-format',
        templateHash: 'old-hash',
      },
    };
    const storage = makeStorage([existing as Route]);
    await restoreDefaultRoute('intend', 'intend-format', storage as any);

    expect(storage.saveRoute).toHaveBeenCalledTimes(1);
    const saved = storage.saveRoute.mock.calls[0][0] as Route;
    // Preserves the original route ID
    expect(saved.id).toBe('route-123');
    // But resets everything else to template defaults
    expect(saved.triggers[0].pattern).toBe(INTEND_TEMPLATE.triggers[0].pattern);
    expect(saved.defaultSource?.templateHash).toBe(computeTemplateHash(INTEND_TEMPLATE));
  });

  it('should throw for unknown integration', async () => {
    const storage = makeStorage([]);
    await expect(restoreDefaultRoute('nope', 'key', storage as any)).rejects.toThrow();
  });

  it('should throw for unknown default key', async () => {
    const storage = makeStorage([]);
    await expect(restoreDefaultRoute('intend', 'nope', storage as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/integrations/default-routes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/integrations/default-routes.ts
import { v4 as uuidv4 } from 'uuid';
import { createTrigger } from '../types.js';
import type { Route, DefaultRouteTemplate } from '../types.js';
import type { StorageInterface } from '../storage/interface.js';
import { getIntegration } from './registry.js';

/**
 * Hash the functional parts of a template (triggers + destinationConfig).
 * Used to detect if a user has modified a default route.
 */
export function computeTemplateHash(template: DefaultRouteTemplate): string {
  const hashInput = JSON.stringify({
    triggers: template.triggers,
    destinationConfig: template.destinationConfig,
  });
  // Simple string hash — not cryptographic, just for equality checks
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Hash the functional parts of an existing route for comparison.
 * Extracts only pattern + priority from triggers (ignoring stats, fireCount, etc.).
 */
export function computeRouteHash(route: Route): string {
  const hashInput = JSON.stringify({
    triggers: route.triggers.map(t => ({ pattern: t.pattern, priority: t.priority })),
    destinationConfig: route.destinationConfig,
  });
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function buildRouteFromTemplate(
  template: DefaultRouteTemplate,
  integrationId: string,
  existingId?: string,
): Route {
  return {
    id: existingId ?? `route-${uuidv4()}`,
    name: template.name,
    description: template.description,
    triggers: template.triggers.map(t => createTrigger(t.pattern, { priority: t.priority })),
    schema: null,
    recentItems: [],
    destinationType: template.destinationType,
    destinationConfig: template.destinationConfig,
    transformScript: template.transformScript,
    createdAt: new Date().toISOString(),
    createdBy: 'integration',
    lastUsed: null,
    defaultSource: {
      integrationId,
      defaultKey: template.key,
      templateHash: computeTemplateHash(template),
    },
  };
}

/**
 * Install default routes for an integration. Skips any that already exist.
 * Returns the count of newly created routes.
 */
export async function installDefaultRoutes(
  integrationId: string,
  storage: StorageInterface,
): Promise<number> {
  const integration = getIntegration(integrationId);
  if (!integration?.defaultRoutes?.length) return 0;

  const existingRoutes = await storage.listRoutes();
  let created = 0;

  for (const template of integration.defaultRoutes) {
    const exists = existingRoutes.some(
      r => r.defaultSource?.integrationId === integrationId
        && r.defaultSource?.defaultKey === template.key
    );
    if (exists) continue;

    const route = buildRouteFromTemplate(template, integrationId);
    await storage.saveRoute(route);
    created++;
  }

  return created;
}

export type DefaultRouteState = 'active' | 'modified' | 'deleted';

export interface DefaultRouteStatus {
  template: DefaultRouteTemplate;
  state: DefaultRouteState;
  existingRouteId?: string;
}

/**
 * Get the status of each default route template for an integration.
 */
export async function getDefaultRouteStatuses(
  integrationId: string,
  storage: StorageInterface,
): Promise<DefaultRouteStatus[]> {
  const integration = getIntegration(integrationId);
  if (!integration?.defaultRoutes?.length) return [];

  const existingRoutes = await storage.listRoutes();

  return integration.defaultRoutes.map(template => {
    const existing = existingRoutes.find(
      r => r.defaultSource?.integrationId === integrationId
        && r.defaultSource?.defaultKey === template.key
    );

    if (!existing) {
      return { template, state: 'deleted' as const };
    }

    // Compare current route hash against the hash stored at install time.
    // This detects user modifications without being affected by template code updates.
    const currentHash = computeRouteHash(existing);
    const installedHash = existing.defaultSource!.templateHash;

    if (currentHash === installedHash) {
      return { template, state: 'active' as const, existingRouteId: existing.id };
    }

    return { template, state: 'modified' as const, existingRouteId: existing.id };
  });
}

/**
 * Restore a default route to its template state.
 * If deleted: creates a new route.
 * If modified: overwrites the existing route (preserving its ID).
 */
export async function restoreDefaultRoute(
  integrationId: string,
  defaultKey: string,
  storage: StorageInterface,
): Promise<void> {
  const integration = getIntegration(integrationId);
  if (!integration?.defaultRoutes?.length) {
    throw new Error(`Integration '${integrationId}' has no default routes`);
  }

  const template = integration.defaultRoutes.find(t => t.key === defaultKey);
  if (!template) {
    throw new Error(`Default route '${defaultKey}' not found on integration '${integrationId}'`);
  }

  const existingRoutes = await storage.listRoutes();
  const existing = existingRoutes.find(
    r => r.defaultSource?.integrationId === integrationId
      && r.defaultSource?.defaultKey === defaultKey
  );

  const route = buildRouteFromTemplate(template, integrationId, existing?.id);
  await storage.saveRoute(route);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/integrations/default-routes.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify full build**

Run: `pnpm build`

- [ ] **Step 6: Commit**

```
feat: add default-routes module with install, status, and restore logic
```

---

## Chunk 2: OAuth Hooks and Dashboard UI

### Task 4: Hook `installDefaultRoutes` into OAuth callbacks

**Files:**
- Modify: `src/server/oauth.ts:172-180` (intend callback)
- Modify: `src/server/oauth.ts:309-315` (sheets callback)

- [ ] **Step 1: Add import**

At top of `src/server/oauth.ts`:

```typescript
import { installDefaultRoutes } from '../integrations/default-routes.js';
```

- [ ] **Step 2: Hook into intend OAuth callback**

After `storage.saveIntendTokens(user, {...})` (line ~177), before the redirect:

```typescript
      const defaultRoutesCreated = await installDefaultRoutes('intend', storage);
      console.log(`[OAuth] intend.do connected successfully for user: ${user}`);
      const redirectUrl = defaultRoutesCreated > 0
        ? `/dashboard/auth?defaultRoutes=${defaultRoutesCreated}`
        : '/dashboard/auth';
      return c.redirect(redirectUrl);
```

Replace the existing `console.log` and `return c.redirect('/dashboard/auth')` lines.

- [ ] **Step 3: Hook into sheets OAuth callback**

After `storage.saveSheetsTokens(user, {...})` (line ~312), before the redirect:

```typescript
      const defaultRoutesCreated = await installDefaultRoutes('sheets', storage);
      console.log(`[OAuth/Sheets] Google Sheets connected successfully for user: ${user}`);
      const redirectUrl = defaultRoutesCreated > 0
        ? `/dashboard/auth?defaultRoutes=${defaultRoutesCreated}`
        : '/dashboard/auth';
      return c.redirect(redirectUrl);
```

Replace the existing `console.log` and `return c.redirect('/dashboard/auth')` lines.

- [ ] **Step 4: Verify build**

Run: `pnpm build`

- [ ] **Step 5: Commit**

```
feat: install default routes on OAuth connect for intend and sheets
```

---

### Task 5: Dashboard UI — toast and default route statuses

**Files:**
- Modify: `src/dashboard/routes.ts:382-466` (auth page handler)

- [ ] **Step 1: Add imports**

At top of `src/dashboard/routes.ts`, add:

```typescript
import { getDefaultRouteStatuses } from '../integrations/default-routes.js';
import { getIntegration } from '../integrations/registry.js';
```

Note: `getIntegration` may need to be added to the existing `registry.js` import if `getIntegrationsWithStatus` is already imported from there.

- [ ] **Step 2: Add toast banner for `defaultRoutes` query param**

In the `app.get('/dashboard/auth', ...)` handler, after getting `blocked`, read the query param and build a banner:

```typescript
    const defaultRoutesAdded = c.req.query('defaultRoutes');
    const defaultRoutesBanner = defaultRoutesAdded ? `
      <div class="card" style="background: #efe; border-left: 4px solid #0a0; margin-bottom: 1rem;">
        <p style="margin: 0; color: #060;">
          ${defaultRoutesAdded} default route${defaultRoutesAdded === '1' ? '' : 's'} auto-added.
        </p>
      </div>
    ` : '';
```

Insert `${defaultRoutesBanner}` right after `<h1>Auth Status</h1>` in the content template.

- [ ] **Step 3: Add default route statuses section**

After the integrations table `</div>` and before the blocked captures card, fetch and render default route statuses for each connected integration that has defaults:

```typescript
    // Gather default route statuses for connected integrations
    const integrationsWithDefaults = integrations.filter(
      i => i.status === 'connected' && getIntegration(i.id)?.defaultRoutes?.length
    );
    let defaultRoutesSection = '';
    if (integrationsWithDefaults.length > 0) {
      const allStatuses = await Promise.all(
        integrationsWithDefaults.map(async i => ({
          integration: i,
          statuses: await getDefaultRouteStatuses(i.id, storage),
        }))
      );

      const rows = allStatuses.flatMap(({ integration, statuses }) =>
        statuses.map(s => {
          const stateDisplay = s.state === 'active'
            ? '<span class="badge badge-success">active</span>'
            : s.state === 'modified'
            ? '<span class="badge badge-warning">customized</span>'
            : '<span class="badge badge-danger">removed</span>';

          const action = s.state === 'active'
            ? '<span class="text-muted">No action needed</span>'
            : `<form method="post" action="/dashboard/default-routes/${integration.id}/${s.template.key}/restore" style="display: inline;"
                ${s.state === 'modified' ? 'onsubmit="return confirm(\'This will overwrite your customizations. Continue?\')"' : ''}>
                <button type="submit" class="btn btn-secondary">
                  ${s.state === 'modified' ? 'Reset to default' : 'Re-add'}
                </button>
              </form>`;

          return `<tr>
            <td><strong>${escapeHtml(integration.name)}</strong></td>
            <td>${escapeHtml(s.template.description)}</td>
            <td>${stateDisplay}</td>
            <td>${action}</td>
          </tr>`;
        })
      );

      if (rows.length > 0) {
        defaultRoutesSection = `
          <div class="card">
            <h3>Default Routes</h3>
            <table>
              <thead>
                <tr><th>Integration</th><th>Route</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          </div>
        `;
      }
    }
```

Insert `${defaultRoutesSection}` in the content template between the integrations card and the blocked captures card.

- [ ] **Step 4: Verify build**

Run: `pnpm build`

- [ ] **Step 5: Commit**

```
feat: show default route statuses and auto-added toast on auth page
```

---

### Task 6: Restore endpoint

**Files:**
- Modify: `src/dashboard/routes.ts`

- [ ] **Step 1: Add import for `restoreDefaultRoute`**

Add `restoreDefaultRoute` to the import from `../integrations/default-routes.js`.

- [ ] **Step 2: Add the restore POST endpoint**

Add after the auth page handler, before the Roam settings page handler:

```typescript
  app.post('/dashboard/default-routes/:integrationId/:key/restore', async (c) => {
    const auth = c.get('auth');
    const { integrationId, key } = c.req.param();

    try {
      await restoreDefaultRoute(integrationId, key, storage);
      return c.redirect('/dashboard/auth');
    } catch (error) {
      console.error('[Dashboard] Failed to restore default route:', error);
      return c.redirect('/dashboard/auth');
    }
  });
```

- [ ] **Step 3: Verify build**

Run: `pnpm build`

- [ ] **Step 4: Commit**

```
feat: add POST endpoint to restore/re-add default routes
```

---

## Chunk 3: E2E and Integration Testing

### Task 7: Run existing tests and verify nothing broke

**Files:** None (verification only)

- [ ] **Step 1: Run unit tests**

Run: `pnpm vitest run tests/integrations/default-routes.test.ts tests/integrations/intend.test.ts`
Expected: All pass

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: No new failures (pre-existing sheets auth failures are known)

- [ ] **Step 3: Verify the intend regex trigger matches expected inputs**

Write a quick verification in the default-routes test file — add a `describe('intend trigger regex')` block:

```typescript
describe('intend trigger regex', () => {
  // The pattern from the intend default route template
  const pattern = INTEND_TEMPLATE.triggers[0].pattern;
  const regex = new RegExp(pattern, 'i');

  const shouldMatch = [
    '1) do laundry',
    '&) random task',
    'FI) run 5k',
    '1,FI) run then rest',
    ') just a task',
    '*1) starred task',
    '// this is a comment',
    '2,3) multi-goal task',
  ];

  const shouldNotMatch = [
    'just some text',
    'hey siri set a timer',
    'weight 88.2kg',
    '',
    ')',
    ') ',   // delimiter + space but no text (.+ requires at least one char)
    '//',   // delimiter with no space or text
    '// ',  // delimiter + space but no text
  ];

  for (const input of shouldMatch) {
    it(`should match: "${input}"`, () => {
      expect(regex.test(input)).toBe(true);
    });
  }

  for (const input of shouldNotMatch) {
    it(`should NOT match: "${input}"`, () => {
      expect(regex.test(input)).toBe(false);
    });
  }
});
```

- [ ] **Step 4: Run the regex tests**

Run: `pnpm vitest run tests/integrations/default-routes.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```
test: add intend trigger regex validation tests
```

---

### Task 8: Start dev server and manually verify

**Files:** None (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: Visit auth status page**

Navigate to `/dashboard/auth` — verify no errors, default routes section appears (or doesn't, depending on intend connection status).

- [ ] **Step 3: If intend is connected, verify the default route status shows**

Check the Default Routes section shows the intend format route with appropriate state (active/modified/deleted).

- [ ] **Step 4: Final commit if any fixes needed**
