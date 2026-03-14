# Route Detail Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign route detail pages with a pipeline-hero visualization, rename "Auth Status" to "Integrations", add pipeline-level string transforms for non-fs destinations, and store matched trigger + transformed payload on captures.

**Architecture:** Add pipeline-level string transforms for non-fs destinations (using `result = ...` convention). Keep existing fs executor transforms as-is (they're imperative I/O scripts). Add two optional fields to Capture (`transformedPayload`, `matchedTrigger`). Rewrite route detail page template with pipeline-hero diagram and accordion sections. Add route filter to captures list page.

**Tech Stack:** TypeScript, Hono, server-rendered HTML templates (no framework), Vitest (unit), Playwright (E2E)

**Important context on transforms:**
- Existing `fs` destination transforms are **imperative I/O scripts** that call `fs.appendFileSync(filePath, payload + '\n')` etc. They write to files directly via a sandboxed `fs` object. They do NOT return a transformed string.
- New pipeline-level transforms use the `result = ...` convention: `result = payload.replace(/^gwen\s+/i, "")`. These are pure string transforms.
- For `fs` destinations: the executor's existing transform logic stays. `transformedPayload` will be null for these captures (we can't easily extract a "transformed output" from an I/O script).
- For non-fs destinations (sheets, roam, intend, notes): the pipeline runs the transform before the executor, and the transformed payload is passed to the executor and stored on the capture.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/types.ts` | Add `transformedPayload` and `matchedTrigger` fields to Capture |
| Modify | `src/pipeline/index.ts` | Run string transform for non-fs destinations, store new fields on capture |
| Modify | `src/dashboard/templates.ts` | Add pipeline-hero renderer, accordion CSS, rename nav link, add `relativeTime` helper, import `getTriggerStatus` from types |
| Modify | `src/dashboard/routes.ts` | Rewrite route detail page handler, add route filter to captures list, rename auth page |
| Modify | `tests/unit/pipeline.test.ts` | Test transform runs for non-fs destinations, test matchedTrigger stored |
| Modify | `tests/unit/dashboard-templates.test.ts` | Test pipeline-hero rendering |
| Modify | `tests/e2e/dashboard.spec.ts` | E2E tests for redesigned route page and renamed nav |

---

## Chunk 1: Schema + Pipeline String Transform

### Task 1: Add new fields to Capture interface

**Files:**
- Modify: `src/types.ts:1-39`

- [ ] **Step 1: Add fields to Capture interface**

In `src/types.ts`, add after `retiredReason` (line 34):

```typescript
  /** The payload after pipeline string transform ran (null if no transform or fs destination) */
  transformedPayload?: string | null;

  /** The trigger pattern string that matched this capture in the dispatcher */
  matchedTrigger?: string | null;
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: Clean compile (fields are optional, no breaking changes)

- [ ] **Step 3: Commit**

```
git add src/types.ts
git commit -m "feat: add transformedPayload and matchedTrigger fields to Capture"
```

---

### Task 2: Add pipeline string transform for non-fs destinations + store matchedTrigger

**Files:**
- Modify: `src/pipeline/index.ts`

**Important:** Do NOT touch `src/routes/executor.ts`. The fs executor's transform logic stays as-is.

- [ ] **Step 1: Write failing test — transform runs for non-fs destination**

In `tests/unit/pipeline.test.ts`, add a test that creates a route with a non-fs `destinationType` and a `transformScript` using the `result = ...` convention. Verify `capture.transformedPayload` is set. Check existing pipeline tests for the correct mock/setup patterns.

```typescript
it('runs pipeline string transform for non-fs destinations and stores transformedPayload', async () => {
  // Create route — adapt to existing test patterns for route creation & mock setup
  const route: Route = {
    id: 'route-transform-test',
    name: 'Transform Test',
    description: 'Test pipeline transform',
    triggers: [{ type: 'regex', pattern: '^gwen\\b', priority: 1, fireCount: 0 }],
    destinationType: 'notes',  // non-fs so pipeline transform applies
    destinationConfig: { target: 'integration', id: 'notes' },
    transformScript: 'result = payload.replace(/^gwen\\s+/i, "")',
    schema: null,
    recentItems: [],
    createdAt: new Date().toISOString(),
    createdBy: 'user',
    lastUsed: null,
  };
  await storage.saveRoute(route);

  const { capture } = await pipeline.process('gwen rolled over today', 'testuser');
  expect(capture.transformedPayload).toBe('rolled over today');
});
```

- [ ] **Step 2: Write failing test — matchedTrigger stored on capture**

```typescript
it('stores matchedTrigger pattern string on capture when trigger matches', async () => {
  const route: Route = {
    id: 'route-trigger-test',
    name: 'Trigger Track Test',
    description: 'Test matched trigger tracking',
    triggers: [{ type: 'regex', pattern: '^hello\\b', priority: 1, fireCount: 5 }],
    destinationType: 'notes',
    destinationConfig: { target: 'integration', id: 'notes' },
    transformScript: null,
    schema: null,
    recentItems: [],
    createdAt: new Date().toISOString(),
    createdBy: 'user',
    lastUsed: null,
  };
  await storage.saveRoute(route);

  const { capture } = await pipeline.process('hello world', 'testuser');
  expect(capture.matchedTrigger).toBe('^hello\\b');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- tests/unit/pipeline.test.ts -t "transformedPayload"`
Run: `pnpm test -- tests/unit/pipeline.test.ts -t "matchedTrigger"`
Expected: Both FAIL

- [ ] **Step 4: Implement — store matchedTrigger after dispatch**

In `src/pipeline/index.ts`, after line 86 (`this.addTrace(capture, 'dispatch', parsed, dispatchResult, dispatchStart);`), add:

```typescript
      // Store matched trigger pattern for dashboard display
      capture.matchedTrigger = dispatchResult.matchedTrigger?.pattern ?? null;
```

- [ ] **Step 5: Implement — run pipeline string transform for non-fs destinations**

In `src/pipeline/index.ts`, just before `// Step 4: Execute` (around line 237), add:

```typescript
      // Step 3.5: Run pipeline string transform for non-fs destinations
      // fs destinations handle transforms in the executor (imperative I/O scripts)
      // Non-fs destinations use pipeline-level string transforms (result = ... convention)
      let effectivePayload = parsed.payload;
      if (route && route.transformScript && route.destinationType !== 'fs') {
        try {
          const vm = await import('vm');
          const transformContext = vm.createContext({
            payload: parsed.payload,
            metadata: parsed.metadata,
            timestamp: capture.timestamp,
            JSON,
            console: { log: () => {}, error: () => {} },
          });
          vm.runInContext(route.transformScript, transformContext, { timeout: 5000 });
          const result = (transformContext as Record<string, unknown>).result as string | undefined;
          if (result !== undefined && result !== parsed.payload) {
            effectivePayload = result;
            capture.transformedPayload = result;
          }
        } catch (error) {
          console.error(`[Pipeline] Transform failed: ${error}`);
          // Fall through with original payload
        }
      }
```

Then update the executor call to use `effectivePayload`:

```typescript
        const execResult = await this.executor.execute(
          route,
          effectivePayload,  // was: parsed.payload
          username,
          parsed.metadata,
          capture.timestamp,
          capture
        );
```

Also update the `addTrace` for execute to log the effective payload:

```typescript
        this.addTrace(capture, 'execute', { route: route.id, payload: effectivePayload }, execResult, executeStart);
```

- [ ] **Step 6: Also update retryCapture to use pipeline transform**

In the `retryCapture` method (around line 808), the retry should also apply the pipeline transform for non-fs destinations:

```typescript
    // Apply pipeline transform for non-fs destinations
    let retryPayload = capture.parsed?.payload || capture.raw;
    if (route.transformScript && route.destinationType !== 'fs') {
      try {
        const vm = await import('vm');
        const transformContext = vm.createContext({
          payload: retryPayload,
          metadata: capture.parsed?.metadata || {},
          timestamp: capture.timestamp,
          JSON,
          console: { log: () => {}, error: () => {} },
        });
        vm.runInContext(route.transformScript, transformContext, { timeout: 5000 });
        const result = (transformContext as Record<string, unknown>).result as string | undefined;
        if (result !== undefined) {
          retryPayload = result;
          capture.transformedPayload = result !== retryPayload ? result : null;
        }
      } catch (error) {
        console.error(`[Pipeline] Retry transform failed: ${error}`);
      }
    }

    const result = await this.executor.execute(
      route,
      retryPayload,  // was: capture.parsed?.payload || capture.raw
      username,
      capture.parsed?.metadata || {},
      capture.timestamp,
      capture
    );
```

- [ ] **Step 7: Run tests**

Run: `pnpm test -- tests/unit/pipeline.test.ts`
Expected: New tests pass, existing tests still pass

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: All pass

- [ ] **Step 9: Commit**

```
git add src/pipeline/index.ts tests/unit/pipeline.test.ts
git commit -m "feat: add pipeline string transform for non-fs destinations

Non-fs destinations (sheets, roam, intend, notes) now support transformScript
using the result = ... convention for string transforms like prefix stripping.
fs destinations keep their existing imperative I/O transform in the executor.
Stores transformedPayload and matchedTrigger on Capture for dashboard display."
```

---

## Chunk 2: Rename "Auth Status" to "Integrations"

### Task 3: Rename nav link and page title

**Files:**
- Modify: `src/dashboard/templates.ts:117`
- Modify: `src/dashboard/routes.ts:382-397`
- Modify: `tests/e2e/dashboard.spec.ts`

- [ ] **Step 1: Write failing E2E test**

In `tests/e2e/dashboard.spec.ts`, update the existing nav link test to look for "integrations" instead of "auth":

```typescript
  test('dashboard home loads and shows navigation', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto(`/dashboard`);

    expect(await page.title()).toContain('Slapture');
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: /captures/i })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: /routes/i })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: /integrations/i })).toBeVisible();
  });
```

- [ ] **Step 2: Run E2E to verify it fails**

Run: `pnpm exec playwright test tests/e2e/dashboard.spec.ts -g "shows navigation"`
Expected: FAIL — looking for "integrations" but finding "auth status"

- [ ] **Step 3: Update nav link in templates.ts**

In `src/dashboard/templates.ts` line 117, change:
```html
<a href="/dashboard/auth">Auth Status</a>
```
to:
```html
<a href="/dashboard/auth">Integrations</a>
```

- [ ] **Step 4: Update page title and sub-heading in routes.ts**

In `src/dashboard/routes.ts`:
- Change `<h1>Auth Status</h1>` to `<h1>Integrations</h1>`
- Change `<h3>Integrations</h3>` to `<h3>Connected Services</h3>` (avoids redundant "Integrations > Integrations")
- Change `layout('Auth Status', content)` to `layout('Integrations', content)`
- Line 482: Change `Back to Auth Status` to `Back to Integrations`
- Line 574: Change `Back to Auth Status` to `Back to Integrations`

- [ ] **Step 5: Run E2E tests**

Run: `pnpm exec playwright test tests/e2e/dashboard.spec.ts`
Expected: All pass. If other E2E tests reference "Auth Status" text, fix those too.

- [ ] **Step 6: Run full E2E suite**

Run: `pnpm exec playwright test`
Expected: All pass

- [ ] **Step 7: Commit**

```
git add src/dashboard/templates.ts src/dashboard/routes.ts tests/e2e/
git commit -m "feat: rename Auth Status to Integrations in dashboard nav"
```

---

## Chunk 3: Route Detail Page Redesign

### Task 4: Add pipeline-hero CSS and renderer to templates

**Files:**
- Modify: `src/dashboard/templates.ts`
- Modify: `tests/unit/dashboard-templates.test.ts`

- [ ] **Step 1: Add pipeline-hero CSS to layout**

Add these styles inside the `<style>` block in the `layout()` function:

```css
/* Pipeline hero */
.pipeline-flow {
  display: flex;
  align-items: stretch;
  justify-content: center;
  margin-bottom: 2rem;
}
.pipeline-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  color: #bbb;
  padding: 0 0.75rem;
}
.pipeline-arrow .v-arrow { display: none; }
.pipeline-box {
  border-radius: 12px;
  padding: 1rem 1.25rem;
  min-width: 180px;
  flex: 1;
  max-width: 280px;
}
.pipeline-box-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.box-triggers { background: #e8f4fd; border: 2px solid #4a9eca; }
.box-triggers .pipeline-box-label { color: #4a9eca; }
.box-transform { background: #fff3e0; border: 2px dashed #ff9800; }
.box-transform .pipeline-box-label { color: #ff9800; }
.box-destination { background: #e8f5e9; border: 2px solid #4caf50; }
.box-destination .pipeline-box-label { color: #4caf50; }
.trigger-item {
  font-family: monospace;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
  background: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
.trigger-live { color: #28a745; }
.trigger-draft { color: #ffc107; }
.meta-line {
  text-align: center;
  font-size: 0.8rem;
  color: #999;
  margin-bottom: 1.5rem;
}
.meta-badge {
  background: #e3f2fd;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-size: 0.7rem;
}
.dest-type-badge {
  background: #c8e6c9;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}
.transform-arrow { color: #ccc; padding: 0 0.35rem; }
.transform-output { color: #888; font-style: italic; }
.verified-badge {
  background: #d1ecf1;
  color: #0c5460;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-size: 0.65rem;
  margin-left: 0.25rem;
}

@media (max-width: 700px) {
  .pipeline-flow {
    flex-direction: column;
    align-items: center;
  }
  .pipeline-arrow {
    padding: 0.25rem 0;
  }
  .pipeline-arrow .h-arrow { display: none; }
  .pipeline-arrow .v-arrow { display: block; }
  .pipeline-box {
    max-width: 100%;
    width: 100%;
  }
}
```

- [ ] **Step 2: Add `relativeTime` helper**

```typescript
export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return formatDate(dateStr);
}
```

- [ ] **Step 3: Add `renderDestinationDetails` helper**

Note: For Roam, the operation type is inside `config.operation` (an object with `type: 'daily_tagged' | 'page_child'`). For `page_child`, the page title is at `config.operation.pageTitle`, NOT `config.pageName`.

```typescript
export function renderDestinationDetails(route: Route): string {
  const config = route.destinationConfig as Record<string, unknown>;
  switch (route.destinationType) {
    case 'fs':
      return `<div style="font-size: 0.85rem; color: #555;">${escapeHtml(String(config.filePath || ''))}</div>`;
    case 'sheets':
      return `<div style="font-size: 0.85rem; color: #555;">${escapeHtml(String(config.spreadsheetId || ''))}</div>
              <div style="font-size: 0.75rem; color: #888;">Sheet: "${escapeHtml(String(config.sheetName || ''))}"</div>`;
    case 'roam': {
      const graph = String(config.graphName || '');
      const op = (config.operation || {}) as Record<string, unknown>;
      const opType = String(op.type || 'daily_tagged');
      const detail = opType === 'page_child'
        ? 'Page: ' + escapeHtml(String(op.pageTitle || ''))
        : 'Daily page (tagged)';
      return `<div style="font-size: 0.85rem; color: #555;">${escapeHtml(graph)}</div>
              <div style="font-size: 0.75rem; color: #888;">${detail}</div>`;
    }
    case 'intend':
      return `<div style="font-size: 0.85rem; color: #555;">${escapeHtml(String(config.baseUrl || ''))}</div>`;
    case 'notes':
      return `<div style="font-size: 0.85rem; color: #555;">Notes</div>`;
    default:
      return `<div style="font-size: 0.85rem; color: #555;">${escapeHtml(route.destinationType)}</div>`;
  }
}
```

- [ ] **Step 4: Add `renderPipelineHero` function**

Export a new function. Must import `getTriggerStatus` from `../types.js` at the top of templates.ts.

```typescript
import type { ExecutionStep, Route } from '../types.js';
import { getTriggerStatus } from '../types.js';  // add this import

export function renderPipelineHero(route: Route, integrationStatus: string): string {
  // Triggers box
  const triggersHtml = route.triggers.length === 0
    ? '<div class="trigger-item" style="color: #999;">No triggers</div>'
    : route.triggers.map(t => {
        const status = getTriggerStatus(t);
        const dot = status === 'draft'
          ? '<span class="trigger-draft">○</span>'
          : '<span class="trigger-live">●</span>';
        const draftLabel = status === 'draft'
          ? ' <span style="font-size: 0.65rem; color: #999;">(draft)</span>'
          : '';
        return `<div class="trigger-item">${dot} ${escapeHtml(t.pattern)}${draftLabel}</div>`;
      }).join('');

  // Transform box (only if transformScript exists)
  const transformHtml = route.transformScript ? `
    <div class="pipeline-arrow">
      <span class="h-arrow">→</span>
      <span class="v-arrow">↓</span>
    </div>
    <div class="pipeline-box box-transform">
      <div class="pipeline-box-label">Transform</div>
      <div style="font-size: 0.8rem; color: #666;">${
        route.transformScript.length <= 60
          ? escapeHtml(route.transformScript)
          : 'Custom transform'
      }</div>
    </div>` : '';

  // Destination box
  const destDetails = renderDestinationDetails(route);
  const connectionStatus = integrationStatus === 'connected'
    ? '<div style="font-size: 0.75rem; color: #888; margin-top: 0.25rem;">Connected ✓</div>'
    : integrationStatus === 'expired'
      ? '<div style="font-size: 0.75rem; color: #dc3545; margin-top: 0.25rem;">Expired ✗</div>'
      : '';

  return `
    <div class="pipeline-flow">
      <div class="pipeline-box box-triggers">
        <div class="pipeline-box-label">Triggers</div>
        ${triggersHtml}
      </div>
      <div class="pipeline-arrow">
        <span class="h-arrow">→</span>
        <span class="v-arrow">↓</span>
      </div>
      ${transformHtml}
      ${route.transformScript ? `<div class="pipeline-arrow"><span class="h-arrow">→</span><span class="v-arrow">↓</span></div>` : ''}
      <div class="pipeline-box box-destination">
        <div class="pipeline-box-label">Destination</div>
        <div style="margin-bottom: 0.35rem;">
          <span class="dest-type-badge">${escapeHtml(route.destinationType)}</span>
        </div>
        ${destDetails}
        ${connectionStatus}
      </div>
    </div>`;
}
```

Note: when `transformScript` is null, the arrow goes directly from triggers to destination (two boxes, one arrow). When transformScript exists, there are three boxes with two arrows between them.

This produces:
- No transform: `[triggers] → [destination]`
- With transform: `[triggers] → [transform] → [destination]`

- [ ] **Step 5: Write unit tests**

In `tests/unit/dashboard-templates.test.ts`, add:

```typescript
import { renderPipelineHero, renderDestinationDetails, relativeTime } from '../../src/dashboard/templates.js';

describe('renderPipelineHero', () => {
  it('renders triggers, transform, and destination boxes', () => {
    const route = {
      id: 'r1', name: 'Test', description: 'Test route',
      triggers: [
        { type: 'regex' as const, pattern: '^gwen\\b', priority: 1, fireCount: 5 },
        { type: 'regex' as const, pattern: 'baby.*memory', priority: 0, fireCount: 0 },
      ],
      destinationType: 'sheets' as const,
      destinationConfig: { spreadsheetId: 'abc123', sheetName: 'Sheet1', operation: { type: 'append_row', columnMappings: [] } },
      transformScript: 'result = payload.replace(/^gwen /i, "")',
      recentItems: [],
      createdAt: new Date().toISOString(),
      createdBy: 'mastermind' as const,
      lastUsed: null,
    };
    const html = renderPipelineHero(route, 'connected');
    expect(html).toContain('box-triggers');
    expect(html).toContain('^gwen\\b');
    expect(html).toContain('box-transform');
    expect(html).toContain('box-destination');
    expect(html).toContain('sheets');
    expect(html).toContain('Connected ✓');
  });

  it('omits transform box when no transformScript', () => {
    const route = {
      id: 'r2', name: 'No Transform', description: '',
      triggers: [{ type: 'regex' as const, pattern: 'test', priority: 1, fireCount: 0 }],
      destinationType: 'notes' as const,
      destinationConfig: { target: 'integration', id: 'notes' },
      transformScript: null,
      recentItems: [],
      createdAt: new Date().toISOString(),
      createdBy: 'user' as const,
      lastUsed: null,
    };
    const html = renderPipelineHero(route, 'connected');
    expect(html).not.toContain('box-transform');
    expect(html).toContain('box-destination');
  });

  it('shows roam destination details with page_child operation', () => {
    const route = {
      id: 'r3', name: 'Roam', description: '',
      triggers: [{ type: 'regex' as const, pattern: 'test', priority: 1, fireCount: 0 }],
      destinationType: 'roam' as const,
      destinationConfig: { graphName: 'my-graph', operation: { type: 'page_child', pageTitle: 'My Page' } },
      transformScript: null,
      recentItems: [],
      createdAt: new Date().toISOString(),
      createdBy: 'user' as const,
      lastUsed: null,
    };
    const html = renderPipelineHero(route, 'connected');
    expect(html).toContain('my-graph');
    expect(html).toContain('Page: My Page');
  });
});

describe('relativeTime', () => {
  it('formats recent times', () => {
    const now = new Date();
    expect(relativeTime(new Date(now.getTime() - 30000).toISOString())).toBe('just now');
    expect(relativeTime(new Date(now.getTime() - 3600000).toISOString())).toBe('1h ago');
    expect(relativeTime(new Date(now.getTime() - 86400000 * 3).toISOString())).toBe('3d ago');
  });
});
```

- [ ] **Step 6: Run tests — verify failures, then implement to pass**

Run: `pnpm test -- tests/unit/dashboard-templates.test.ts`

- [ ] **Step 7: Commit**

```
git add src/dashboard/templates.ts tests/unit/dashboard-templates.test.ts
git commit -m "feat: add pipeline-hero renderer and CSS for route detail pages"
```

---

### Task 5: Rewrite route detail page handler

**Files:**
- Modify: `src/dashboard/routes.ts:275-379`

- [ ] **Step 1: Rewrite the route detail page handler**

Replace the existing handler at `app.get('/dashboard/routes/:routeId', ...)` with the new layout. Import `renderPipelineHero`, `relativeTime`, `renderDestinationDetails` from templates.

The handler needs to:
- Get integration status: find the route's integration in `await getIntegrationsWithStatus(storage, auth.uid)` and get its status string
- Calculate success rate: `Math.round(successCaptures.length / totalCaptures.length * 100)` (handle 0 total → show "—")
- Sort captures by timestamp descending, limit to 10
- Find origin capture for mastermind-created routes: earliest capture by timestamp
- Extract mastermind reasoning from origin capture's `executionTrace`: `step.output?.reason` where `step.step === 'mastermind'`

Structure:
1. `renderPipelineHero(route, integrationStatus)` — the hero diagram
2. Meta line: `<div class="meta-line">Created by <span class="meta-badge">${route.createdBy}</span> · ${count} captures · ${successRate}% success · Last used ${route.lastUsed ? relativeTime(route.lastUsed) : 'never'}</div>`
3. Recent Captures: `<details open><summary>Recent Captures <span style="color: #999; font-size: 0.8rem;">(${count} total)</span></summary>` with table
4. Version History: `<details><summary>...</summary>` with table showing version, time, reason, and a compact "Changes" column
5. Origin (only if `route.createdBy === 'mastermind'`): `<details><summary>Origin — created by mastermind</summary>` with first capture link and mastermind reasoning

Key: captures table rows show:
- Time column: `relativeTime(c.timestamp)`
- Input → Output column: raw input (linked to capture detail), optional `↳ transformedPayload` on second line
- Matched column: `c.matchedTrigger` in `<code>` or "—" if null
- Status column: `statusBadge(c.executionResult)`

For the "View all N captures" link at the bottom of the captures table:
```html
<div style="text-align: center; padding: 0.5rem; font-size: 0.8rem;">
  <a href="/dashboard/captures?route=${route.id}">View all ${routeCaptures.length} captures →</a>
</div>
```

- [ ] **Step 2: Add route filter to captures list page**

In the captures list handler (find the `/dashboard/captures` GET handler), add support for `?route=` query param:

```typescript
const routeFilter = c.req.query('route');
```

After fetching captures, filter if param present:
```typescript
if (routeFilter) {
  filteredCaptures = filteredCaptures.filter(cap => cap.routeFinal === routeFilter);
}
```

Also add a visual indicator when filtered — e.g., add to the page header:
```typescript
${routeFilter ? `<p class="text-muted">Filtered by route: <code>${escapeHtml(routeFilter)}</code> · <a href="/dashboard/captures">Clear filter</a></p>` : ''}
```

Ensure any existing pagination or filter links preserve the `?route=` param. Specifically:
- Add a hidden input to the filter form: `${routeFilter ? `<input type="hidden" name="route" value="${escapeHtml(routeFilter)}">` : ''}`
- Update pagination link construction to include `&route=${routeFilter}` when present

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Clean compile

- [ ] **Step 4: Write E2E tests**

In `tests/e2e/dashboard.spec.ts`, add:

```typescript
test.describe('Route Detail (redesigned)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('shows pipeline hero with triggers and destination', async ({ page }) => {
    await page.goto('/dashboard/routes');
    const firstRoute = page.locator('table tbody tr td a').first();
    if (await firstRoute.count() === 0) {
      test.skip(true, 'No routes exist');
      return;
    }
    await firstRoute.click();

    await expect(page.locator('.box-triggers')).toBeVisible();
    await expect(page.locator('.box-destination')).toBeVisible();
    await expect(page.locator('.pipeline-arrow')).toBeVisible();
    await expect(page.locator('.meta-line')).toBeVisible();
  });

  test('recent captures accordion is open by default', async ({ page }) => {
    await page.goto('/dashboard/routes');
    const firstRoute = page.locator('table tbody tr td a').first();
    if (await firstRoute.count() === 0) {
      test.skip(true, 'No routes exist');
      return;
    }
    await firstRoute.click();

    const recentDetails = page.locator('details').first();
    await expect(recentDetails).toHaveAttribute('open', '');
  });
});
```

- [ ] **Step 5: Run E2E tests**

Run: `pnpm exec playwright test tests/e2e/dashboard.spec.ts`
Expected: All pass

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Run: `pnpm exec playwright test`
Expected: All pass

- [ ] **Step 7: Commit**

```
git add src/dashboard/routes.ts src/dashboard/templates.ts tests/
git commit -m "feat: redesign route detail page with pipeline-hero visualization

- Visual flow: triggers → transform → destination with responsive arrows
- Accordion sections for captures, version history, and origin
- Captures show transformed output and matched trigger
- Route filter added to captures list page (?route=id)
- Origin section shows mastermind reasoning for auto-created routes"
```
