# Retry Blocked Captures After Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user finishes connecting an integration (intend, sheets, roam), automatically retry any of their captures previously blocked on that integration; surface a `/dashboard/blocked` view so the user can watch retries resolve and trigger manual retries.

**Architecture:** Add a storage filter and pipeline batch method that retries blocked captures sequentially (oldest first). Wire the OAuth/connection callbacks to fire the batch fire-and-forget after saving tokens, then redirect to a new dashboard view that lists blocked captures with per-capture and bulk retry buttons.

**Tech Stack:** TypeScript, Hono, Vitest, Playwright. Existing pipeline (`retryCapture`), storage interface (`StorageInterface`), and dashboard rendering helpers (`layout`, `escapeHtml`, `statusBadge`).

**Spec:** `docs/superpowers/specs/2026-04-30-retry-blocked-captures-after-auth-design.md`

---

## Task 1: Storage filter — `listCapturesBlockedFor(username, integration)`

**Files:**
- Modify: `src/storage/interface.ts` — add method to interface
- Modify: `src/storage/index.ts` — implement on local `Storage`
- Modify: `src/storage/firestore.ts` — implement on `FirestoreStorage`
- Test: `tests/unit/storage.test.ts` (or create the section if absent)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/storage.test.ts`. If a `describe('listCapturesBlockedFor', ...)` block doesn't exist, create one inside the existing `describe('Storage', ...)`:

```ts
describe('listCapturesBlockedFor', () => {
  it('returns only blocked captures for the given integration', async () => {
    const storage = new Storage(TEST_DATA_DIR);

    const baseCapture = {
      raw: 'x',
      timestamp: '2026-04-01T00:00:00Z',
      username: 'alice',
      parsed: null,
      routeProposed: null,
      routeConfidence: null,
      executionTrace: [],
      verificationState: 'pending' as const,
      retiredFromTests: false,
      retiredReason: null,
    };

    await storage.saveCapture({ ...baseCapture, id: 'a', routeFinal: 'route-sheets-weight', executionResult: 'blocked_needs_auth', timestamp: '2026-04-01T00:00:00Z' }, 'alice');
    await storage.saveCapture({ ...baseCapture, id: 'b', routeFinal: 'route-intend-todo', executionResult: 'blocked_needs_auth', timestamp: '2026-04-02T00:00:00Z' }, 'alice');
    await storage.saveCapture({ ...baseCapture, id: 'c', routeFinal: 'route-sheets-mood', executionResult: 'blocked_auth_expired', timestamp: '2026-04-03T00:00:00Z' }, 'alice');
    await storage.saveCapture({ ...baseCapture, id: 'd', routeFinal: 'route-sheets-weight', executionResult: 'success', timestamp: '2026-04-04T00:00:00Z' }, 'alice');

    const sheetsBlocked = await storage.listCapturesBlockedFor('alice', 'sheets');

    const ids = sheetsBlocked.map(c => c.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/storage.test.ts -t "listCapturesBlockedFor"`
Expected: FAIL with `storage.listCapturesBlockedFor is not a function`.

- [ ] **Step 3: Add method to interface**

In `src/storage/interface.ts`, add immediately after the existing `listCapturesNeedingAuth` line (line 13):

```ts
  listCapturesBlockedFor(username: string, integration: string): Promise<Capture[]>;
```

- [ ] **Step 4: Implement on local Storage**

In `src/storage/index.ts`, add immediately after `listCapturesNeedingAuth` (around line 401):

```ts
  // List captures blocked on a specific integration (e.g. 'sheets', 'intend', 'roam')
  async listCapturesBlockedFor(username: string, integration: string): Promise<Capture[]> {
    const blocked = await this.listCapturesNeedingAuth(username);
    return blocked.filter(c => c.routeFinal !== null && c.routeFinal.includes(integration));
  }
```

- [ ] **Step 5: Implement on FirestoreStorage**

In `src/storage/firestore.ts`, add immediately after `listCapturesNeedingAuth` (around line 87):

```ts
  async listCapturesBlockedFor(username: string, integration: string): Promise<Capture[]> {
    const blocked = await this.listCapturesNeedingAuth(username);
    return blocked.filter(c => c.routeFinal !== null && c.routeFinal.includes(integration));
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/unit/storage.test.ts -t "listCapturesBlockedFor"`
Expected: PASS.

- [ ] **Step 7: Run full unit suite**

Run: `pnpm test`
Expected: All tests pass (no regressions in interface implementations).

- [ ] **Step 8: Commit**

```bash
git add src/storage/interface.ts src/storage/index.ts src/storage/firestore.ts tests/unit/storage.test.ts
git commit -m "feat: add listCapturesBlockedFor storage filter"
```

---

## Task 2: Pipeline batch retry — `retryBlockedForIntegration`

**Files:**
- Modify: `src/pipeline/index.ts` — add new method after `retryCapture` (around line 944)
- Test: `tests/unit/pipeline.test.ts` — add tests inside existing `describe('retryCapture', ...)` or new `describe('retryBlockedForIntegration', ...)`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/pipeline.test.ts`, after the existing `describe('retryCapture', ...)` block:

```ts
describe('retryBlockedForIntegration', () => {
  it('retries only captures matching the integration, oldest first', async () => {
    // Two routes: one sheets, one intend
    const sheetsRoute: Route = {
      id: 'route-sheets',
      name: 'sheets-test',
      description: '',
      triggers: [{ type: 'keyword', pattern: 'sheets', priority: 10 }],
      schema: null, recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'sheets.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-04-01T00:00:00Z', createdBy: 'user', lastUsed: null,
    };
    const intendRoute: Route = { ...sheetsRoute, id: 'route-intend', name: 'intend-test', destinationConfig: { filePath: 'intend.txt' } };
    await storage.saveRoute(sheetsRoute);
    await storage.saveRoute(intendRoute);

    const baseCapture = {
      parsed: { payload: 'x', metadata: {} },
      routeProposed: null, routeConfidence: null,
      executionTrace: [],
      verificationState: 'pending' as const,
      retiredFromTests: false, retiredReason: null,
    };

    // Two sheets-blocked, one intend-blocked, one already-success
    await storage.saveCapture({ ...baseCapture, id: 's1', raw: 'x', username: 'u', timestamp: '2026-04-02T00:00:00Z', routeFinal: 'route-sheets', executionResult: 'blocked_needs_auth' }, 'u');
    await storage.saveCapture({ ...baseCapture, id: 's2', raw: 'x', username: 'u', timestamp: '2026-04-01T00:00:00Z', routeFinal: 'route-sheets', executionResult: 'blocked_needs_auth' }, 'u');
    await storage.saveCapture({ ...baseCapture, id: 'i1', raw: 'x', username: 'u', timestamp: '2026-04-01T00:00:00Z', routeFinal: 'route-intend', executionResult: 'blocked_needs_auth' }, 'u');
    await storage.saveCapture({ ...baseCapture, id: 'd1', raw: 'x', username: 'u', timestamp: '2026-04-01T00:00:00Z', routeFinal: 'route-sheets', executionResult: 'success' }, 'u');

    // Spy on retryCapture to record call order
    const calls: string[] = [];
    const origRetry = pipeline.retryCapture.bind(pipeline);
    vi.spyOn(pipeline, 'retryCapture').mockImplementation(async (cap) => {
      calls.push(cap.id);
      return origRetry(cap);
    });

    const summary = await pipeline.retryBlockedForIntegration('u', 'sheets');

    // Order: oldest first (s2 timestamp 04-01, then s1 timestamp 04-02)
    expect(calls).toEqual(['s2', 's1']);
    expect(summary.attempted).toBe(2);
    // Both succeed (fs route, no real auth required, so they "retry" successfully)
    expect(summary.succeeded).toBe(2);
    expect(summary.stillBlocked).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('continues batch when an individual retry throws', async () => {
    await storage.saveCapture({
      id: 'a', raw: 'x', username: 'u', timestamp: '2026-04-01T00:00:00Z',
      parsed: { payload: 'x', metadata: {} },
      routeProposed: null, routeConfidence: null,
      routeFinal: 'route-sheets', executionResult: 'blocked_needs_auth',
      executionTrace: [], verificationState: 'pending' as const,
      retiredFromTests: false, retiredReason: null,
    }, 'u');
    await storage.saveCapture({
      id: 'b', raw: 'x', username: 'u', timestamp: '2026-04-02T00:00:00Z',
      parsed: { payload: 'x', metadata: {} },
      routeProposed: null, routeConfidence: null,
      routeFinal: 'route-sheets', executionResult: 'blocked_needs_auth',
      executionTrace: [], verificationState: 'pending' as const,
      retiredFromTests: false, retiredReason: null,
    }, 'u');

    const sheetsRoute: Route = {
      id: 'route-sheets', name: 'sheets', description: '',
      triggers: [{ type: 'keyword', pattern: 'sheets', priority: 10 }],
      schema: null, recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'sheets.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: '2026-04-01T00:00:00Z', createdBy: 'user', lastUsed: null,
    };
    await storage.saveRoute(sheetsRoute);

    let callIdx = 0;
    vi.spyOn(pipeline, 'retryCapture').mockImplementation(async (cap) => {
      callIdx += 1;
      if (callIdx === 1) throw new Error('boom');
      return { capture: cap };
    });

    const summary = await pipeline.retryBlockedForIntegration('u', 'sheets');
    expect(summary.attempted).toBe(2);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    // Did not abort after first throw
    expect(callIdx).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/unit/pipeline.test.ts -t "retryBlockedForIntegration"`
Expected: FAIL with `pipeline.retryBlockedForIntegration is not a function`.

- [ ] **Step 3: Implement the method**

In `src/pipeline/index.ts`, add immediately after `retryCapture` (after line 944, inside the class):

```ts
  /**
   * Retry every capture for `username` that is blocked on the named integration
   * (e.g. 'sheets', 'intend', 'roam'). Sequential, oldest first. Errors in
   * individual retries are caught so one failure doesn't halt the batch.
   */
  async retryBlockedForIntegration(
    username: string,
    integration: string,
  ): Promise<{ attempted: number; succeeded: number; stillBlocked: number; failed: number }> {
    const blocked = await this.storage.listCapturesBlockedFor(username, integration);
    const ordered = [...blocked].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let succeeded = 0;
    let stillBlocked = 0;
    let failed = 0;

    for (const capture of ordered) {
      try {
        const { capture: result } = await this.retryCapture(capture);
        if (result.executionResult === 'success') {
          succeeded += 1;
        } else if (
          result.executionResult === 'blocked_needs_auth' ||
          result.executionResult === 'blocked_auth_expired'
        ) {
          stillBlocked += 1;
        } else {
          failed += 1;
        }
      } catch (err) {
        failed += 1;
        console.error(`[Pipeline] retryBlockedForIntegration: capture ${capture.id} threw:`, err);
      }
    }

    return { attempted: ordered.length, succeeded, stillBlocked, failed };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/unit/pipeline.test.ts -t "retryBlockedForIntegration"`
Expected: PASS for both new tests.

- [ ] **Step 5: Run full unit suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/index.ts tests/unit/pipeline.test.ts
git commit -m "feat: pipeline.retryBlockedForIntegration for oldest-first batch retry"
```

---

## Task 3: Server endpoints — `POST /retry/blocked` and pass pipeline to OAuth/Roam builders

**Files:**
- Modify: `src/server/index.ts` — pass `pipeline` to `buildOAuthRoutes` and `buildRoamRoutes`; add `POST /retry/blocked`
- Modify: `src/server/oauth.ts` — accept `pipeline` parameter on `buildOAuthRoutes`
- Modify: `src/server/roam.ts` — accept `pipeline` parameter on `buildRoamRoutes`

(Wiring of the actual auto-retry calls inside the callbacks happens in Task 4; this task just plumbs the pipeline reference through and adds the bulk retry endpoint.)

- [ ] **Step 1: Update `buildOAuthRoutes` signature**

In `src/server/oauth.ts`, change the imports and signature at line 1-3 and line 87:

```ts
// src/server/oauth.ts
import type { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import type { CapturePipeline } from '../pipeline/index.js';
import { installDefaultRoutes } from '../integrations/default-routes.js';
```

```ts
export function buildOAuthRoutes(
  app: Hono,
  storage: StorageInterface,
  pipeline: CapturePipeline,
  config: OAuthConfig
): void {
```

- [ ] **Step 2: Update `buildRoamRoutes` signature**

In `src/server/roam.ts`, update imports at line 1-4 and signature at line 6:

```ts
// src/server/roam.ts
import type { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import type { CapturePipeline } from '../pipeline/index.js';
import { RoamClient } from '../integrations/roam/client.js';

export function buildRoamRoutes(app: Hono, storage: StorageInterface, pipeline: CapturePipeline): void {
```

- [ ] **Step 3: Update call sites in `src/server/index.ts`**

In `src/server/index.ts`, change the `buildOAuthRoutes` and `buildRoamRoutes` calls at lines 236 and 246:

```ts
  // OAuth routes
  buildOAuthRoutes(app, storage, pipeline, {
    intendClientId: process.env.INTEND_CLIENT_ID || '',
    intendClientSecret: process.env.INTEND_CLIENT_SECRET || '',
    intendBaseUrl: process.env.INTEND_BASE_URL || 'https://intend.do',
    callbackBaseUrl: process.env.CALLBACK_BASE_URL || 'http://localhost:4444',
    sheetsClientId: process.env.GOOGLE_CLIENT_ID,
    sheetsClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });

  // Roam routes
  buildRoamRoutes(app, storage, pipeline);
```

- [ ] **Step 4: Add `POST /retry/blocked` endpoint**

In `src/server/index.ts`, immediately after the existing `POST /retry/:captureId` block (around line 218), add:

```ts
  // POST /retry/blocked - retry all of the user's currently blocked captures, oldest first
  app.post('/retry/blocked', async (c) => {
    const username = c.get('auth')?.uid;
    if (!username) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const blocked = await storage.listCapturesNeedingAuth(username);
    const ordered = [...blocked].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    let succeeded = 0;
    let stillBlocked = 0;
    let failed = 0;

    for (const capture of ordered) {
      try {
        const { capture: result } = await pipeline.retryCapture(capture);
        if (result.executionResult === 'success') succeeded += 1;
        else if (result.executionResult === 'blocked_needs_auth' || result.executionResult === 'blocked_auth_expired') stillBlocked += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        console.error(`[Server] /retry/blocked: capture ${capture.id} threw:`, err);
      }
    }

    return c.json({ attempted: ordered.length, succeeded, stillBlocked, failed });
  });
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts src/server/oauth.ts src/server/roam.ts
git commit -m "feat: thread pipeline into OAuth/Roam builders, add POST /retry/blocked"
```

---

## Task 4: Wire auto-retry into OAuth & Roam connection callbacks

**Files:**
- Modify: `src/server/oauth.ts` — intend callback (around line 180), sheets callback (around line 320)
- Modify: `src/server/roam.ts` — both `POST /api/roam/connect` (line 9) and `POST /connect/roam` (line 68)

The contract: after a successful token save, capture pre-retry blocked count, kick off `pipeline.retryBlockedForIntegration` without `await`, then redirect (intend/sheets) or respond (roam) appropriately. Failures inside the fire-and-forget call must not surface as user-facing errors.

- [ ] **Step 1: Wire intend callback**

In `src/server/oauth.ts`, find the success branch of the intend callback (around lines 180-185, immediately after `installDefaultRoutes('intend', storage)`) and replace:

```ts
      const defaultRoutesCreated = await installDefaultRoutes('intend', storage);
      console.log(`[OAuth] intend.do connected successfully for user: ${user}`);
      const redirectUrl = defaultRoutesCreated > 0
        ? `/dashboard/auth?defaultRoutes=${defaultRoutesCreated}`
        : '/dashboard/auth';
      return c.redirect(redirectUrl);
```

with:

```ts
      const defaultRoutesCreated = await installDefaultRoutes('intend', storage);
      console.log(`[OAuth] intend.do connected successfully for user: ${user}`);

      // Snapshot blocked count BEFORE kicking off retries, to decide where to redirect
      const blockedBefore = await storage.listCapturesBlockedFor(user, 'intend');

      // Fire-and-forget batch retry
      pipeline.retryBlockedForIntegration(user, 'intend')
        .then(summary => console.log(`[OAuth] intend retry summary for ${user}:`, summary))
        .catch(err => console.error(`[OAuth] intend retry batch failed for ${user}:`, err));

      const redirectUrl = blockedBefore.length > 0
        ? '/dashboard/blocked'
        : (defaultRoutesCreated > 0 ? `/dashboard/auth?defaultRoutes=${defaultRoutesCreated}` : '/dashboard/auth');
      return c.redirect(redirectUrl);
```

- [ ] **Step 2: Wire sheets callback**

In `src/server/oauth.ts`, find the success branch of the sheets callback (around lines 319-324, after `installDefaultRoutes('sheets', storage)`) and replace:

```ts
      const defaultRoutesCreated = await installDefaultRoutes('sheets', storage);
      console.log(`[OAuth/Sheets] Google Sheets connected successfully for user: ${user}`);
      const redirectUrl = defaultRoutesCreated > 0
        ? `/dashboard/auth?defaultRoutes=${defaultRoutesCreated}`
        : '/dashboard/auth';
      return c.redirect(redirectUrl);
```

with:

```ts
      const defaultRoutesCreated = await installDefaultRoutes('sheets', storage);
      console.log(`[OAuth/Sheets] Google Sheets connected successfully for user: ${user}`);

      const blockedBefore = await storage.listCapturesBlockedFor(user, 'sheets');

      pipeline.retryBlockedForIntegration(user, 'sheets')
        .then(summary => console.log(`[OAuth/Sheets] sheets retry summary for ${user}:`, summary))
        .catch(err => console.error(`[OAuth/Sheets] sheets retry batch failed for ${user}:`, err));

      const redirectUrl = blockedBefore.length > 0
        ? '/dashboard/blocked'
        : (defaultRoutesCreated > 0 ? `/dashboard/auth?defaultRoutes=${defaultRoutesCreated}` : '/dashboard/auth');
      return c.redirect(redirectUrl);
```

- [ ] **Step 3: Wire `POST /api/roam/connect` (JSON API)**

In `src/server/roam.ts`, replace the closing of `app.post('/api/roam/connect', ...)` (around line 38-41):

```ts
    await storage.saveRoamConfig(auth.uid, { graphs });
    console.log(`[Roam] Graph "${graphName}" connected for user: ${auth.uid}`);

    return c.json({ success: true, graphName });
```

with:

```ts
    await storage.saveRoamConfig(auth.uid, { graphs });
    console.log(`[Roam] Graph "${graphName}" connected for user: ${auth.uid}`);

    pipeline.retryBlockedForIntegration(auth.uid, 'roam')
      .then(summary => console.log(`[Roam] retry summary for ${auth.uid}:`, summary))
      .catch(err => console.error(`[Roam] retry batch failed for ${auth.uid}:`, err));

    return c.json({ success: true, graphName });
```

- [ ] **Step 4: Wire `POST /connect/roam` (form-based)**

In `src/server/roam.ts`, replace the closing of `app.post('/connect/roam', ...)` (around line 99-102):

```ts
    await storage.saveRoamConfig(auth.uid, { graphs });
    console.log(`[Roam] Graph "${graphName}" connected for user: ${auth.uid}`);

    return c.redirect('/dashboard/roam');
```

with:

```ts
    await storage.saveRoamConfig(auth.uid, { graphs });
    console.log(`[Roam] Graph "${graphName}" connected for user: ${auth.uid}`);

    const blockedBefore = await storage.listCapturesBlockedFor(auth.uid, 'roam');

    pipeline.retryBlockedForIntegration(auth.uid, 'roam')
      .then(summary => console.log(`[Roam] retry summary for ${auth.uid}:`, summary))
      .catch(err => console.error(`[Roam] retry batch failed for ${auth.uid}:`, err));

    return c.redirect(blockedBefore.length > 0 ? '/dashboard/blocked' : '/dashboard/roam');
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/oauth.ts src/server/roam.ts
git commit -m "feat: auto-retry blocked captures after OAuth/Roam connection"
```

---

## Task 5: Dashboard `/dashboard/blocked` view

**Files:**
- Modify: `src/dashboard/routes.ts` — add the new GET handler
- Modify: `src/dashboard/templates.ts` — add a "Blocked" nav link

- [ ] **Step 1: Add nav link**

In `src/dashboard/templates.ts`, add a "Blocked" link in the nav (around line 213):

```html
    <a href="/dashboard/api-keys">API Keys</a>
    <a href="/dashboard/blocked">Blocked</a>
    <a href="/dashboard/test-suite">Test Suite</a>
```

- [ ] **Step 2: Add the route handler**

In `src/dashboard/routes.ts`, add this route handler. Insert it before the `// API key management routes` section if present, otherwise just before the closing of `buildDashboardRoutes`. The handler should be added near the other dashboard list handlers (e.g., after `/dashboard/captures`):

```ts
  // Dashboard: blocked captures view
  app.get('/dashboard/blocked', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.redirect('/login');
    }

    const blocked = await storage.listCapturesNeedingAuth(auth.uid);
    const ordered = [...blocked].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const tableBody = ordered.length === 0
      ? '<p class="empty-state">No blocked captures right now.</p>'
      : `
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Input</th>
              <th>Route</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${ordered.map(cap => `
              <tr>
                <td>${formatDate(cap.timestamp)}</td>
                <td class="text-truncate">${escapeHtml(cap.raw)}</td>
                <td>${cap.routeFinal ? escapeHtml(cap.routeFinal) : '-'}</td>
                <td>${statusBadge(cap.executionResult)}</td>
                <td>
                  <form method="post" action="/retry/${escapeHtml(cap.id)}" style="display:inline">
                    <button type="submit" class="btn">Retry</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    const retryAllForm = ordered.length === 0 ? '' : `
      <form method="post" action="/retry/blocked" style="margin-bottom: 1rem;">
        <button type="submit" class="btn">Retry all blocked (${ordered.length})</button>
      </form>
    `;

    // Auto-refresh while items are still blocked so user sees them resolve
    const refreshTag = ordered.length > 0
      ? '<meta http-equiv="refresh" content="3">'
      : '';

    const content = `
      ${refreshTag}
      <h1>Blocked Captures</h1>
      <p class="text-muted">Captures waiting on integration auth. They retry automatically after you connect; this page refreshes every few seconds.</p>
      ${retryAllForm}
      <div class="card">
        ${tableBody}
      </div>
    `;

    return c.html(layout('Blocked', content));
  });
```

Note: `<meta http-equiv="refresh">` lives inside `<body>` here, which is technically non-standard (it belongs in `<head>`). Browsers honor it anyway, and the `layout()` helper in this codebase doesn't accept extra `<head>` content. If the existing codebase pattern shows another usage of meta-refresh, follow that pattern instead. Otherwise leave as-is — it works.

- [ ] **Step 3: Manual smoke test (start the dev server)**

Run: `pnpm dev > ./tmp/slapture.log 2>&1 &`
Wait briefly for it to come up, then in a browser visit `http://localhost:4444/dashboard/blocked` while logged in.

Expected:
- Page renders with "Blocked Captures" heading.
- Either the empty state or a table of blocked captures.
- Nav has the "Blocked" link highlighted/visible.
- If the list is non-empty, "Retry" and "Retry all blocked (N)" buttons appear.

Stop the dev server when done.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/routes.ts src/dashboard/templates.ts
git commit -m "feat: /dashboard/blocked view with per-capture and bulk retry"
```

---

## Task 6: E2E test — Sheets OAuth completion auto-retries blocked capture

**Files:**
- Modify: `tests/e2e/sheets-oauth.spec.ts` — add a new test inside the existing `test.describe('Google Sheets OAuth Integration', …)` block

The existing first test at lines 64–98 already drives the full Google consent flow (email → password → consent screens → callback). Reuse that flow here. The existing test currently asserts redirect to `/dashboard/auth`; that test stays as-is and continues to pass because the test user starts with no blocked captures. Our new test creates a blocked capture *before* OAuth so the redirect goes to `/dashboard/blocked`.

A "blocked sheets capture" requires a route whose `destinationType` is `sheets` to already exist for the user. That route's destinationConfig should point to a spreadsheet the test user owns ("baby memories", per CLAUDE.md). Adding a sheets route via the dashboard requires sheets auth — which is what we're testing — so we instead seed the route via the existing default-route-install path (which runs *during* OAuth callback, after token save). That means the first capture we send must route there *after* OAuth, but we need a blocked capture *before* OAuth.

**Approach:** create a sheets-routed capture via the API while a sheets route already exists from a prior session. Two options:

- **Option A (recommended):** Run `loginAsTestUser` → connect sheets → disconnect → submit capture (which now routes to a sheets route but is blocked because tokens are gone — `blocked_auth_expired`) → reconnect sheets via OAuth → assert redirect to `/dashboard/blocked` and capture transitions to success.
- **Option B:** Manually seed a sheets route via storage before the test. More setup, more brittle.

Use Option A.

- [ ] **Step 1: Write the failing E2E test**

Add to `tests/e2e/sheets-oauth.spec.ts`, inside the `test.describe('Google Sheets OAuth Integration', …)` block (after the existing tests, before the closing `});`):

```ts
  test('completing sheets OAuth after disconnect auto-retries blocked captures and lands on /dashboard/blocked', async ({ page }) => {
    // 1. Connect sheets via OAuth (this also installs default sheets routes for the user).
    //    Reuses the same flow as the first test in this file.
    await page.goto('/dashboard/integrations/sheets');
    await page.click('a[href="/connect/sheets"]');
    await page.waitForURL(/accounts\.google\.com/, { timeout: 15000 });

    const emailField1 = page.locator('#identifierId, input[type="email"]');
    if (await emailField1.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailField1.fill(GOOGLE_TEST_ACCOUNT);
      await emailField1.press('Enter');
      await page.waitForTimeout(3000);
      const passwordField1 = page.locator('input[type="password"][name="Passwd"], input[type="password"]');
      await passwordField1.waitFor({ state: 'visible', timeout: 15000 });
      await passwordField1.fill(GOOGLE_TEST_ACCOUNT_PASSWORD);
      await passwordField1.press('Enter');
      await page.waitForTimeout(5000);
    }
    await handleGoogleConsentScreens(page);
    // After first connect, we have no blocked captures yet, so we land on /dashboard/auth as before.
    await expect(page).toHaveURL(/\/dashboard\/(auth|blocked)/, { timeout: 30000 });

    // 2. Disconnect sheets — this should clear the user's sheets tokens but leave routes in place.
    await page.goto('/dashboard/auth');
    const sheetsRow = page.locator('tr', { hasText: 'Google Sheets' });
    const disconnectButton = sheetsRow.locator('button:has-text("Disconnect")');
    if (await disconnectButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await disconnectButton.click();
      await page.waitForURL(/\/dashboard\/auth/, { timeout: 10000 });
    }

    // 3. Submit a capture that will route to a sheets destination but block on missing auth.
    //    Adapt the trigger text to whatever default sheets route is installed by `installDefaultRoutes('sheets', ...)`.
    //    If there is no default sheets route created automatically, this test must skip or seed one explicitly.
    const testRaw = `sheets-test-${Date.now()}`;
    const captureResponse = await page.request.post('/capture', {
      data: { text: testRaw },
    });
    expect(captureResponse.ok()).toBeTruthy();

    // 4. Confirm the capture appears on /dashboard/blocked.
    await page.goto('/dashboard/blocked');
    // If the capture didn't route to a sheets destination at all, this test is in the wrong shape and
    // the surrounding default-route assumption is wrong — skip with a clear message in that case.
    const visibleOnBlocked = await page.getByText(testRaw).isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!visibleOnBlocked,
      'Capture did not land on /dashboard/blocked — the default sheets route trigger does not match this raw text. Update testRaw to match a known default sheets trigger.');

    // 5. Reconnect Sheets via OAuth — this should auto-retry the blocked capture and redirect to /dashboard/blocked.
    await page.goto('/dashboard/integrations/sheets');
    await page.click('a[href="/connect/sheets"]');
    await page.waitForURL(/accounts\.google\.com/, { timeout: 15000 });

    // Google may remember the account and skip email/password — handle both paths.
    const emailField2 = page.locator('#identifierId, input[type="email"]');
    if (await emailField2.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailField2.fill(GOOGLE_TEST_ACCOUNT);
      await emailField2.press('Enter');
      await page.waitForTimeout(3000);
      const passwordField2 = page.locator('input[type="password"][name="Passwd"], input[type="password"]');
      if (await passwordField2.isVisible({ timeout: 5000 }).catch(() => false)) {
        await passwordField2.fill(GOOGLE_TEST_ACCOUNT_PASSWORD);
        await passwordField2.press('Enter');
        await page.waitForTimeout(5000);
      }
    }
    await handleGoogleConsentScreens(page);

    // 6. Should land on /dashboard/blocked because we had blocked captures pre-retry.
    await expect(page).toHaveURL(/\/dashboard\/blocked/, { timeout: 30000 });

    // 7. Poll until the capture is no longer in the blocked list (auto-retry succeeded).
    await expect(async () => {
      await page.reload();
      const stillBlocked = await page.getByText(testRaw).isVisible({ timeout: 1000 }).catch(() => false);
      expect(stillBlocked).toBe(false);
    }).toPass({ timeout: 30_000 });

    // 8. Verify the capture now shows success in the captures list.
    await page.goto('/dashboard/captures?status=success');
    await expect(page.getByText(testRaw)).toBeVisible();
  });
```

- [ ] **Step 2: Run the new test**

Run: `pnpm playwright test tests/e2e/sheets-oauth.spec.ts -g "auto-retries blocked"`

Expected: PASS. Two known failure modes:

- *Test skips at step 4* — means the `testRaw` doesn't match any default sheets route's trigger pattern. Inspect `src/integrations/default-routes.ts` to find a sheets default route and a trigger pattern that matches; update `testRaw` to satisfy that pattern.
- *Test fails at step 6 (URL is `/dashboard/auth` not `/dashboard/blocked`)* — the `blockedBefore.length > 0` snapshot in Task 4 didn't see the capture as blocked. Verify (a) the capture really has `executionResult: 'blocked_auth_expired'` after step 3, and (b) `listCapturesBlockedFor(user, 'sheets')` returns it (its `routeFinal` must include `'sheets'`).

- [ ] **Step 3: Run the existing sheets-oauth tests to confirm no regression**

Run: `pnpm playwright test tests/e2e/sheets-oauth.spec.ts`
Expected: All four tests pass (the original three + the new one).

- [ ] **Step 4: Run all e2e to check for cross-spec regressions**

Run: `pnpm playwright test`
Expected: No regressions vs. the pre-task baseline.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/sheets-oauth.spec.ts
git commit -m "test(e2e): sheets OAuth completion auto-retries blocked captures"
```

---

## Final verification

- [ ] **All unit tests:** `pnpm test`
- [ ] **TypeScript:** `pnpm tsc --noEmit`
- [ ] **All e2e tests:** `pnpm playwright test`
- [ ] **Manual smoke:** start `pnpm dev`, log in, post a sheets-routed capture while disconnected, observe it appears on `/dashboard/blocked`, connect sheets, observe redirect to `/dashboard/blocked` and the capture transitioning out of blocked.
