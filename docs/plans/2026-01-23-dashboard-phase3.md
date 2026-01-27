# Phase 3: Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a server-rendered dashboard for viewing captures, managing routes, and handling auth status.

**Architecture:** Fastify server-rendered HTML pages using template functions. No frontend build step. Reuse existing Storage class and API patterns. Add new `/dashboard/*` routes with same token auth.

**Tech Stack:** Fastify, TypeScript, inline HTML templates, existing Storage class

---

## Task 1: Dashboard Layout and Home Page

**Files:**
- Create: `src/dashboard/templates.ts` - HTML template utilities
- Create: `src/dashboard/routes.ts` - Dashboard route handlers
- Modify: `src/server/index.ts:156-164` - Add dashboard routes
- Test: `tests/e2e/dashboard.spec.ts` - E2E tests for dashboard

**Step 1: Write the failing test**

```typescript
// tests/e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';

const TOKEN = 'dev-token';

test.describe('Dashboard', () => {
  test('dashboard home loads and shows navigation', async ({ page }) => {
    await page.goto(`/dashboard?token=${TOKEN}`);

    expect(await page.title()).toContain('Slapture');
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.getByRole('link', { name: /captures/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /routes/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /auth/i })).toBeVisible();
  });

  test('dashboard requires auth token', async ({ page }) => {
    const response = await page.goto('/dashboard');
    expect(response?.status()).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: FAIL - 404 or route not found

**Step 3: Create template utilities**

```typescript
// src/dashboard/templates.ts

export function layout(title: string, content: string, token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Slapture Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
    }
    nav {
      background: #333;
      padding: 1rem 2rem;
      display: flex;
      gap: 2rem;
      align-items: center;
    }
    nav a {
      color: #fff;
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
    }
    nav a:hover { background: #444; }
    nav a.active { background: #007aff; }
    .logo { font-weight: bold; font-size: 1.25rem; margin-right: auto; }
    main { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    h1 { margin-bottom: 1.5rem; color: #333; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-danger { background: #f8d7da; color: #721c24; }
    .badge-info { background: #cce5ff; color: #004085; }
    .badge-secondary { background: #e2e3e5; color: #383d41; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
    th { font-weight: 500; color: #666; }
    .btn {
      display: inline-block;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.875rem;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: #007aff; color: white; }
    .btn-secondary { background: #6c757d; color: white; }
    .btn-danger { background: #dc3545; color: white; }
    .btn:hover { opacity: 0.9; }
    .filter-bar {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .filter-bar select, .filter-bar input {
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .text-muted { color: #666; }
    .text-truncate {
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: #666;
    }
  </style>
</head>
<body>
  <nav>
    <span class="logo">Slapture</span>
    <a href="/dashboard?token=${token}">Home</a>
    <a href="/dashboard/captures?token=${token}">Captures</a>
    <a href="/dashboard/routes?token=${token}">Routes</a>
    <a href="/dashboard/auth?token=${token}">Auth Status</a>
  </nav>
  <main>
    ${content}
  </main>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, c => map[c]);
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function statusBadge(status: string): string {
  const classes: Record<string, string> = {
    success: 'badge-success',
    failed: 'badge-danger',
    pending: 'badge-warning',
    rejected: 'badge-secondary',
    blocked_needs_auth: 'badge-warning',
    blocked_auth_expired: 'badge-danger',
  };
  const labels: Record<string, string> = {
    success: 'Success',
    failed: 'Failed',
    pending: 'Pending',
    rejected: 'Rejected',
    blocked_needs_auth: 'Needs Auth',
    blocked_auth_expired: 'Auth Expired',
  };
  return `<span class="badge ${classes[status] || 'badge-secondary'}">${labels[status] || status}</span>`;
}

export function verificationBadge(state: string): string {
  const classes: Record<string, string> = {
    human_verified: 'badge-success',
    ai_certain: 'badge-info',
    ai_uncertain: 'badge-warning',
    failed: 'badge-danger',
    pending: 'badge-secondary',
  };
  const labels: Record<string, string> = {
    human_verified: 'Verified',
    ai_certain: 'AI Certain',
    ai_uncertain: 'AI Uncertain',
    failed: 'Failed',
    pending: 'Pending',
  };
  return `<span class="badge ${classes[state] || 'badge-secondary'}">${labels[state] || state}</span>`;
}
```

**Step 4: Create dashboard routes**

```typescript
// src/dashboard/routes.ts
import { FastifyInstance } from 'fastify';
import { Storage } from '../storage/index.js';
import { layout, escapeHtml, formatDate, statusBadge, verificationBadge } from './templates.js';

export function buildDashboardRoutes(server: FastifyInstance, storage: Storage): void {
  // Dashboard home
  server.get<{ Querystring: { token: string } }>('/dashboard', async (request, reply) => {
    const token = request.query.token;

    const [captures, routes, blocked] = await Promise.all([
      storage.listCaptures(10),
      storage.listRoutes(),
      storage.listCapturesNeedingAuth(),
    ]);

    const content = `
      <h1>Dashboard</h1>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
        <div class="card">
          <h3>${captures.length}</h3>
          <p class="text-muted">Recent Captures</p>
        </div>
        <div class="card">
          <h3>${routes.length}</h3>
          <p class="text-muted">Routes</p>
        </div>
        <div class="card">
          <h3>${blocked.length}</h3>
          <p class="text-muted">Blocked Captures</p>
        </div>
      </div>

      <h2>Recent Captures</h2>
      <div class="card">
        ${captures.length === 0 ? '<p class="empty-state">No captures yet</p>' : `
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Input</th>
                <th>Route</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${captures.slice(0, 5).map(c => `
                <tr>
                  <td>${formatDate(c.timestamp)}</td>
                  <td class="text-truncate">${escapeHtml(c.raw)}</td>
                  <td>${c.routeFinal || '-'}</td>
                  <td>${statusBadge(c.executionResult)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p style="margin-top: 1rem;"><a href="/dashboard/captures?token=${token}">View all captures →</a></p>
        `}
      </div>
    `;

    reply.type('text/html').send(layout('Home', content, token));
  });
}
```

**Step 5: Wire up dashboard routes in server**

Modify `src/server/index.ts` - add import and call after OAuth routes:

```typescript
// Add import at top
import { buildDashboardRoutes } from '../dashboard/routes.js';

// Add after buildOAuthRoutes call (around line 162)
buildDashboardRoutes(server, storage);
```

Also update the auth hook to skip dashboard routes (they use query token like other routes).

**Step 6: Run test to verify it passes**

Run: `pnpm build && pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/dashboard/ tests/e2e/dashboard.spec.ts src/server/index.ts
git commit -m "feat(dashboard): add layout and home page

- Add template utilities with layout, escapeHtml, badges
- Add dashboard home with stats cards
- Wire up /dashboard route with token auth

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Capture List View with Filtering

**Files:**
- Modify: `src/dashboard/routes.ts` - Add captures list route
- Modify: `src/dashboard/templates.ts` - Add pagination helper
- Test: `tests/e2e/dashboard.spec.ts` - Add capture list tests

**Step 1: Write the failing test**

Add to `tests/e2e/dashboard.spec.ts`:

```typescript
test.describe('Capture List', () => {
  test('shows capture list with filters', async ({ page }) => {
    await page.goto(`/dashboard/captures?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Captures');
    await expect(page.locator('select[name="status"]')).toBeVisible();
    await expect(page.locator('input[name="search"]')).toBeVisible();
  });

  test('filters by status', async ({ page }) => {
    await page.goto(`/dashboard/captures?token=${TOKEN}&status=success`);

    // Should show filter applied
    const select = page.locator('select[name="status"]');
    await expect(select).toHaveValue('success');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: FAIL - 404 for /dashboard/captures

**Step 3: Add capture list route**

Add to `src/dashboard/routes.ts`:

```typescript
// Captures list
server.get<{
  Querystring: { token: string; status?: string; search?: string; page?: string };
}>('/dashboard/captures', async (request, reply) => {
  const { token, status, search, page: pageStr } = request.query;
  const page = parseInt(pageStr || '1', 10);
  const perPage = 25;

  let captures = await storage.listAllCaptures();

  // Filter by status
  if (status && status !== 'all') {
    captures = captures.filter(c => c.executionResult === status);
  }

  // Filter by search
  if (search) {
    const searchLower = search.toLowerCase();
    captures = captures.filter(c =>
      c.raw.toLowerCase().includes(searchLower) ||
      (c.routeFinal && c.routeFinal.toLowerCase().includes(searchLower))
    );
  }

  // Sort by timestamp descending
  captures.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Paginate
  const totalPages = Math.ceil(captures.length / perPage);
  const paginatedCaptures = captures.slice((page - 1) * perPage, page * perPage);

  const statuses = ['all', 'success', 'failed', 'pending', 'rejected', 'blocked_needs_auth', 'blocked_auth_expired'];

  const content = `
    <h1>Captures</h1>

    <form class="filter-bar" method="get" action="/dashboard/captures">
      <input type="hidden" name="token" value="${token}">
      <select name="status" onchange="this.form.submit()">
        ${statuses.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s === 'all' ? 'All Statuses' : s}</option>`).join('')}
      </select>
      <input type="text" name="search" placeholder="Search..." value="${escapeHtml(search || '')}">
      <button type="submit" class="btn btn-secondary">Filter</button>
    </form>

    <div class="card">
      ${paginatedCaptures.length === 0 ? '<p class="empty-state">No captures match your filters</p>' : `
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Input</th>
              <th>Route</th>
              <th>Status</th>
              <th>Verification</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${paginatedCaptures.map(c => `
              <tr>
                <td>${formatDate(c.timestamp)}</td>
                <td class="text-truncate" title="${escapeHtml(c.raw)}">${escapeHtml(c.raw)}</td>
                <td>${c.routeFinal || '-'}</td>
                <td>${statusBadge(c.executionResult)}</td>
                <td>${verificationBadge(c.verificationState)}</td>
                <td>
                  <a href="/dashboard/captures/${c.id}?token=${token}" class="btn btn-secondary">View</a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${totalPages > 1 ? `
          <div style="margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: center;">
            ${page > 1 ? `<a href="/dashboard/captures?token=${token}&status=${status || 'all'}&search=${encodeURIComponent(search || '')}&page=${page - 1}" class="btn btn-secondary">← Prev</a>` : ''}
            <span style="padding: 0.5rem;">Page ${page} of ${totalPages}</span>
            ${page < totalPages ? `<a href="/dashboard/captures?token=${token}&status=${status || 'all'}&search=${encodeURIComponent(search || '')}&page=${page + 1}" class="btn btn-secondary">Next →</a>` : ''}
          </div>
        ` : ''}
      `}
    </div>
  `;

  reply.type('text/html').send(layout('Captures', content, token));
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/routes.ts tests/e2e/dashboard.spec.ts
git commit -m "feat(dashboard): add capture list with filtering

- Filter by status and search text
- Pagination support
- Links to capture detail view

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Capture Detail View with Verify/Correct Actions

**Files:**
- Modify: `src/dashboard/routes.ts` - Add capture detail route
- Modify: `src/storage/index.ts` - Add updateCapture method
- Test: `tests/e2e/dashboard.spec.ts` - Add detail view tests

**Step 1: Write the failing test**

Add to `tests/e2e/dashboard.spec.ts`:

```typescript
test.describe('Capture Detail', () => {
  test('shows capture detail with execution trace', async ({ page, request }) => {
    // First create a capture
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: test detail view' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Capture Detail');
    await expect(page.locator('text=dump: test detail view')).toBeVisible();
    await expect(page.locator('text=Execution Trace')).toBeVisible();
  });

  test('can verify a capture as correct', async ({ page, request }) => {
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: verify me' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}?token=${TOKEN}`);
    await page.click('button:has-text("Verify Correct")');

    // Should show verified badge
    await expect(page.locator('.badge-success:has-text("Verified")')).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: FAIL - 404 for capture detail

**Step 3: Add updateCapture to storage**

Add to `src/storage/index.ts`:

```typescript
async updateCapture(capture: Capture): Promise<void> {
  // Find the file and update it
  const capturesDir = path.join(this.dataDir, 'captures');

  // Check legacy format
  const legacyPath = path.join(capturesDir, `${capture.id}.json`);
  if (fs.existsSync(legacyPath)) {
    fs.writeFileSync(legacyPath, JSON.stringify(capture, null, 2));
    return;
  }

  // Search in user subdirectories
  const entries = fs.readdirSync(capturesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const userDir = path.join(capturesDir, entry.name);
      const files = fs.readdirSync(userDir).filter(f => f.endsWith(`_${capture.id}.json`));
      if (files.length > 0) {
        fs.writeFileSync(path.join(userDir, files[0]), JSON.stringify(capture, null, 2));
        return;
      }
    }
  }

  // If not found, save as new (use username from capture)
  await this.saveCapture(capture, capture.username || 'default');
}
```

**Step 4: Add capture detail and verify routes**

Add to `src/dashboard/routes.ts`:

```typescript
// Capture detail
server.get<{
  Params: { captureId: string };
  Querystring: { token: string };
}>('/dashboard/captures/:captureId', async (request, reply) => {
  const { captureId } = request.params;
  const { token } = request.query;

  const capture = await storage.getCapture(captureId);
  if (!capture) {
    return reply.code(404).type('text/html').send(layout('Not Found', '<h1>Capture not found</h1>', token));
  }

  const route = capture.routeFinal ? await storage.getRoute(capture.routeFinal) : null;
  const routes = await storage.listRoutes();

  const content = `
    <h1>Capture Detail</h1>

    <div class="card">
      <h3>Input</h3>
      <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto;">${escapeHtml(capture.raw)}</pre>
    </div>

    <div class="card">
      <h3>Status</h3>
      <table>
        <tr><td><strong>ID</strong></td><td><code>${capture.id}</code></td></tr>
        <tr><td><strong>Time</strong></td><td>${formatDate(capture.timestamp)}</td></tr>
        <tr><td><strong>Status</strong></td><td>${statusBadge(capture.executionResult)}</td></tr>
        <tr><td><strong>Verification</strong></td><td>${verificationBadge(capture.verificationState)}</td></tr>
        <tr><td><strong>Route</strong></td><td>${capture.routeFinal ? `<a href="/dashboard/routes/${capture.routeFinal}?token=${token}">${capture.routeFinal}</a>` : '-'}</td></tr>
        <tr><td><strong>Confidence</strong></td><td>${capture.routeConfidence || '-'}</td></tr>
      </table>
    </div>

    <div class="card">
      <h3>Actions</h3>
      <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
        ${capture.verificationState !== 'human_verified' ? `
          <form method="post" action="/dashboard/captures/${captureId}/verify?token=${token}" style="margin: 0;">
            <button type="submit" class="btn btn-primary">Verify Correct</button>
          </form>
        ` : '<span class="badge badge-success">Already Verified</span>'}

        ${['blocked_needs_auth', 'blocked_auth_expired'].includes(capture.executionResult) ? `
          <form method="post" action="/retry/${captureId}?token=${token}" style="margin: 0;">
            <button type="submit" class="btn btn-secondary">Retry</button>
          </form>
        ` : ''}
      </div>
    </div>

    <div class="card">
      <h3>Execution Trace</h3>
      ${capture.executionTrace.length === 0 ? '<p class="text-muted">No trace recorded</p>' : `
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Duration</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            ${capture.executionTrace.map(step => `
              <tr>
                <td><strong>${step.step}</strong></td>
                <td>${step.durationMs}ms</td>
                <td><pre style="margin: 0; font-size: 0.75rem; max-width: 400px; overflow-x: auto;">${escapeHtml(JSON.stringify(step.output, null, 2).slice(0, 500))}</pre></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <p style="margin-top: 1rem;">
      <a href="/dashboard/captures?token=${token}">← Back to captures</a>
    </p>
  `;

  reply.type('text/html').send(layout('Capture Detail', content, token));
});

// Verify capture
server.post<{
  Params: { captureId: string };
  Querystring: { token: string };
}>('/dashboard/captures/:captureId/verify', async (request, reply) => {
  const { captureId } = request.params;
  const { token } = request.query;

  const capture = await storage.getCapture(captureId);
  if (!capture) {
    return reply.code(404).send({ error: 'Capture not found' });
  }

  capture.verificationState = 'human_verified';
  await storage.updateCapture(capture);

  reply.redirect(`/dashboard/captures/${captureId}?token=${token}`);
});
```

**Step 5: Run test to verify it passes**

Run: `pnpm build && pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/dashboard/routes.ts src/storage/index.ts tests/e2e/dashboard.spec.ts
git commit -m "feat(dashboard): add capture detail view with verify action

- Show full capture details and execution trace
- Verify Correct button sets human_verified
- Retry button for blocked captures

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Route Management View

**Files:**
- Modify: `src/dashboard/routes.ts` - Add routes list and detail
- Test: `tests/e2e/dashboard.spec.ts` - Add route management tests

**Step 1: Write the failing test**

Add to `tests/e2e/dashboard.spec.ts`:

```typescript
test.describe('Route Management', () => {
  test('shows route list with stats', async ({ page }) => {
    await page.goto(`/dashboard/routes?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Routes');
    await expect(page.locator('table')).toBeVisible();
    // Should show at least the dump route
    await expect(page.locator('text=dump')).toBeVisible();
  });

  test('shows route detail with triggers', async ({ page }) => {
    // Get the dump route ID
    const routes = await page.request.get(`/routes?token=${TOKEN}`);
    const routeList = await routes.json();
    const dumpRoute = routeList.find((r: { name: string }) => r.name === 'dump');

    await page.goto(`/dashboard/routes/${dumpRoute.id}?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('dump');
    await expect(page.locator('text=Triggers')).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: FAIL - 404 for /dashboard/routes

**Step 3: Add route list and detail routes**

Add to `src/dashboard/routes.ts`:

```typescript
// Routes list
server.get<{ Querystring: { token: string } }>('/dashboard/routes', async (request, reply) => {
  const { token } = request.query;
  const routes = await storage.listRoutes();
  const allCaptures = await storage.listAllCaptures();

  // Calculate stats for each route
  const routeStats = routes.map(route => {
    const routeCaptures = allCaptures.filter(c => c.routeFinal === route.id);
    const successCount = routeCaptures.filter(c => c.executionResult === 'success').length;
    const totalCount = routeCaptures.length;
    const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

    return {
      ...route,
      totalCaptures: totalCount,
      successRate,
      lastUsed: route.lastUsed ? formatDate(route.lastUsed) : 'Never',
    };
  });

  const content = `
    <h1>Routes</h1>

    <div class="card">
      ${routes.length === 0 ? '<p class="empty-state">No routes configured</p>' : `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Triggers</th>
              <th>Total Captures</th>
              <th>Success Rate</th>
              <th>Last Used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${routeStats.map(r => `
              <tr>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td><span class="badge badge-info">${r.destinationType}</span></td>
                <td>${r.triggers.length}</td>
                <td>${r.totalCaptures}</td>
                <td>${r.successRate}%</td>
                <td class="text-muted">${r.lastUsed}</td>
                <td>
                  <a href="/dashboard/routes/${r.id}?token=${token}" class="btn btn-secondary">View</a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  reply.type('text/html').send(layout('Routes', content, token));
});

// Route detail
server.get<{
  Params: { routeId: string };
  Querystring: { token: string };
}>('/dashboard/routes/:routeId', async (request, reply) => {
  const { routeId } = request.params;
  const { token } = request.query;

  const route = await storage.getRoute(routeId);
  if (!route) {
    return reply.code(404).type('text/html').send(layout('Not Found', '<h1>Route not found</h1>', token));
  }

  const allCaptures = await storage.listAllCaptures();
  const routeCaptures = allCaptures.filter(c => c.routeFinal === route.id);

  const content = `
    <h1>${escapeHtml(route.name)}</h1>

    <div class="card">
      <h3>Details</h3>
      <table>
        <tr><td><strong>ID</strong></td><td><code>${route.id}</code></td></tr>
        <tr><td><strong>Description</strong></td><td>${escapeHtml(route.description)}</td></tr>
        <tr><td><strong>Destination Type</strong></td><td><span class="badge badge-info">${route.destinationType}</span></td></tr>
        <tr><td><strong>Created</strong></td><td>${formatDate(route.createdAt)}</td></tr>
        <tr><td><strong>Created By</strong></td><td>${route.createdBy}</td></tr>
        <tr><td><strong>Last Used</strong></td><td>${route.lastUsed ? formatDate(route.lastUsed) : 'Never'}</td></tr>
      </table>
    </div>

    <div class="card">
      <h3>Triggers</h3>
      ${route.triggers.length === 0 ? '<p class="text-muted">No triggers configured</p>' : `
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Pattern</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            ${route.triggers.map(t => `
              <tr>
                <td><span class="badge badge-secondary">${t.type}</span></td>
                <td><code>${escapeHtml(t.pattern)}</code></td>
                <td>${t.priority}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div class="card">
      <h3>Recent Captures (${routeCaptures.length} total)</h3>
      ${routeCaptures.length === 0 ? '<p class="text-muted">No captures for this route</p>' : `
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Input</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${routeCaptures.slice(0, 10).map(c => `
              <tr>
                <td>${formatDate(c.timestamp)}</td>
                <td class="text-truncate"><a href="/dashboard/captures/${c.id}?token=${token}">${escapeHtml(c.raw)}</a></td>
                <td>${statusBadge(c.executionResult)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    ${route.versions && route.versions.length > 0 ? `
      <div class="card">
        <h3>Version History</h3>
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Time</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${route.versions.map(v => `
              <tr>
                <td>v${v.version}</td>
                <td>${formatDate(v.timestamp)}</td>
                <td>${escapeHtml(v.reason)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}

    <p style="margin-top: 1rem;">
      <a href="/dashboard/routes?token=${token}">← Back to routes</a>
    </p>
  `;

  reply.type('text/html').send(layout(route.name, content, token));
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/routes.ts tests/e2e/dashboard.spec.ts
git commit -m "feat(dashboard): add route management view

- Route list with stats (total captures, success rate, last used)
- Route detail with triggers and recent captures
- Version history display

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Auth Status View

**Files:**
- Modify: `src/dashboard/routes.ts` - Add auth status page
- Test: `tests/e2e/dashboard.spec.ts` - Add auth status tests

**Step 1: Write the failing test**

Add to `tests/e2e/dashboard.spec.ts`:

```typescript
test.describe('Auth Status', () => {
  test('shows integration status list', async ({ page }) => {
    await page.goto(`/dashboard/auth?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Auth Status');
    // Should show integrations
    await expect(page.locator('text=intend.do')).toBeVisible();
    await expect(page.locator('text=Local Files')).toBeVisible();
  });

  test('shows blocked captures count', async ({ page }) => {
    await page.goto(`/dashboard/auth?token=${TOKEN}`);

    // Should show blocked captures section
    await expect(page.locator('text=Blocked Captures')).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: FAIL - 404 for /dashboard/auth

**Step 3: Add auth status route**

Add to `src/dashboard/routes.ts` (also import getIntegrationsWithStatus):

```typescript
// Add import at top
import { getIntegrationsWithStatus } from '../integrations/registry.js';

// Auth status page
server.get<{ Querystring: { token: string } }>('/dashboard/auth', async (request, reply) => {
  const { token } = request.query;

  // Get integrations with status for default user
  const integrations = await getIntegrationsWithStatus(storage, 'default');
  const blocked = await storage.listCapturesNeedingAuth();

  const statusBadgeMap: Record<string, string> = {
    connected: 'badge-success',
    expired: 'badge-danger',
    'not-connected': 'badge-warning',
  };

  const content = `
    <h1>Auth Status</h1>

    <div class="card">
      <h3>Integrations</h3>
      <table>
        <thead>
          <tr>
            <th>Integration</th>
            <th>Purpose</th>
            <th>Auth Type</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${integrations.map(i => `
            <tr>
              <td><strong>${escapeHtml(i.name)}</strong></td>
              <td class="text-muted">${escapeHtml(i.purpose)}</td>
              <td><span class="badge badge-secondary">${i.authType}</span></td>
              <td><span class="badge ${statusBadgeMap[i.status]}">${i.status}</span></td>
              <td>
                ${i.authType === 'oauth' ? `
                  ${i.status === 'connected' ? `
                    <form method="post" action="/disconnect/${i.id}?token=${token}&redirect=/dashboard/auth" style="display: inline;">
                      <button type="submit" class="btn btn-danger">Disconnect</button>
                    </form>
                  ` : `
                    <a href="/connect/${i.id}?token=${token}" class="btn btn-primary">Connect</a>
                  `}
                ` : '<span class="text-muted">No auth needed</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>Blocked Captures</h3>
      ${blocked.length === 0 ? '<p class="text-muted">No captures blocked on auth</p>' : `
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Input</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${blocked.map(c => `
              <tr>
                <td>${formatDate(c.timestamp)}</td>
                <td class="text-truncate">${escapeHtml(c.raw)}</td>
                <td>${statusBadge(c.executionResult)}</td>
                <td>
                  <a href="/dashboard/captures/${c.id}?token=${token}" class="btn btn-secondary">View</a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  reply.type('text/html').send(layout('Auth Status', content, token));
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/routes.ts tests/e2e/dashboard.spec.ts
git commit -m "feat(dashboard): add auth status view

- Show all integrations with auth status
- Connect/disconnect buttons for OAuth
- List blocked captures needing auth

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Correction Flow (Wrong Route)

**Files:**
- Modify: `src/dashboard/routes.ts` - Add correction flow
- Modify: `src/storage/index.ts` - Add method to mark as negative example
- Test: `tests/e2e/dashboard.spec.ts` - Add correction tests

**Step 1: Write the failing test**

Add to `tests/e2e/dashboard.spec.ts`:

```typescript
test.describe('Correction Flow', () => {
  test('can mark capture as wrong and select correct route', async ({ page, request }) => {
    // Create a capture
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: correction test' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}?token=${TOKEN}`);

    // Click "This was wrong"
    await page.click('button:has-text("This was wrong")');

    // Should show correction form
    await expect(page.locator('text=Select correct route')).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: FAIL - no "This was wrong" button

**Step 3: Add correction flow**

Update the capture detail route to include "This was wrong" button, and add correction routes:

Add to capture detail actions section in `src/dashboard/routes.ts`:

```typescript
// In the capture detail route, update the Actions card:
<div class="card">
  <h3>Actions</h3>
  <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
    ${capture.verificationState !== 'human_verified' ? `
      <form method="post" action="/dashboard/captures/${captureId}/verify?token=${token}" style="margin: 0;">
        <button type="submit" class="btn btn-primary">Verify Correct</button>
      </form>
      <a href="/dashboard/captures/${captureId}/correct?token=${token}" class="btn btn-secondary">This was wrong</a>
    ` : '<span class="badge badge-success">Already Verified</span>'}

    ${['blocked_needs_auth', 'blocked_auth_expired'].includes(capture.executionResult) ? `
      <form method="post" action="/retry/${captureId}?token=${token}" style="margin: 0;">
        <button type="submit" class="btn btn-secondary">Retry</button>
      </form>
    ` : ''}
  </div>
</div>
```

Add correction page and submit routes:

```typescript
// Correction page
server.get<{
  Params: { captureId: string };
  Querystring: { token: string };
}>('/dashboard/captures/:captureId/correct', async (request, reply) => {
  const { captureId } = request.params;
  const { token } = request.query;

  const capture = await storage.getCapture(captureId);
  if (!capture) {
    return reply.code(404).type('text/html').send(layout('Not Found', '<h1>Capture not found</h1>', token));
  }

  const routes = await storage.listRoutes();

  const content = `
    <h1>Correct Capture</h1>

    <div class="card">
      <h3>Original Input</h3>
      <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px;">${escapeHtml(capture.raw)}</pre>
      <p class="text-muted">Currently routed to: <strong>${capture.routeFinal || 'none'}</strong></p>
    </div>

    <div class="card">
      <h3>Select correct route</h3>
      <form method="post" action="/dashboard/captures/${captureId}/correct?token=${token}">
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;">
          ${routes.map(r => `
            <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">
              <input type="radio" name="correctRoute" value="${r.id}" ${r.id === capture.routeFinal ? 'disabled' : ''}>
              <strong>${escapeHtml(r.name)}</strong>
              <span class="text-muted">- ${escapeHtml(r.description)}</span>
              ${r.id === capture.routeFinal ? '<span class="badge badge-warning">Current</span>' : ''}
            </label>
          `).join('')}
        </div>

        <div style="margin-bottom: 1rem;">
          <label for="reason">Reason (optional):</label>
          <input type="text" name="reason" id="reason" style="width: 100%; padding: 0.5rem; margin-top: 0.5rem;" placeholder="Why was this routing wrong?">
        </div>

        <div style="display: flex; gap: 1rem;">
          <button type="submit" class="btn btn-primary">Submit Correction</button>
          <a href="/dashboard/captures/${captureId}?token=${token}" class="btn btn-secondary">Cancel</a>
        </div>
      </form>
    </div>
  `;

  reply.type('text/html').send(layout('Correct Capture', content, token));
});

// Submit correction
server.post<{
  Params: { captureId: string };
  Querystring: { token: string };
  Body: { correctRoute: string; reason?: string };
}>('/dashboard/captures/:captureId/correct', async (request, reply) => {
  const { captureId } = request.params;
  const { token } = request.query;
  const { correctRoute, reason } = request.body;

  const capture = await storage.getCapture(captureId);
  if (!capture) {
    return reply.code(404).send({ error: 'Capture not found' });
  }

  // Mark capture as corrected
  capture.verificationState = 'human_verified';

  // Add to execution trace
  capture.executionTrace.push({
    step: 'route_validate',
    timestamp: new Date().toISOString(),
    input: { originalRoute: capture.routeFinal, correctedTo: correctRoute },
    output: { reason: reason || 'User correction' },
    codeVersion: 'dashboard-correction',
    durationMs: 0,
  });

  // Update the route to the correct one
  const oldRoute = capture.routeFinal;
  capture.routeFinal = correctRoute;

  await storage.updateCapture(capture);

  // Mark as negative example on old route (update recentItems)
  if (oldRoute) {
    const route = await storage.getRoute(oldRoute);
    if (route) {
      const existingRef = route.recentItems.find(r => r.captureId === captureId);
      if (existingRef) {
        existingRef.wasCorrect = false;
      }
      await storage.saveRoute(route);
    }
  }

  reply.redirect(`/dashboard/captures/${captureId}?token=${token}`);
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/routes.ts tests/e2e/dashboard.spec.ts
git commit -m "feat(dashboard): add correction flow for misrouted captures

- 'This was wrong' button on capture detail
- Route selection form with reason
- Marks old route example as incorrect
- Updates capture to correct route

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Test Suite View

**Files:**
- Modify: `src/dashboard/routes.ts` - Add test suite view
- Test: `tests/e2e/dashboard.spec.ts` - Add test suite tests

**Step 1: Write the failing test**

Add to `tests/e2e/dashboard.spec.ts`:

```typescript
test.describe('Test Suite View', () => {
  test('shows verified captures as golden tests', async ({ page, request }) => {
    // Create and verify a capture
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: test suite item' },
    });
    const { captureId } = await res.json();

    // Verify it
    await request.post(`/dashboard/captures/${captureId}/verify?token=${TOKEN}`);

    // Check test suite
    await page.goto(`/dashboard/test-suite?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Test Suite');
    await expect(page.locator('text=test suite item')).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: FAIL - 404 for /dashboard/test-suite

**Step 3: Add test suite view**

Add to navigation in `templates.ts`:

```typescript
// Update nav in layout function to include Test Suite link
<a href="/dashboard/test-suite?token=${token}">Test Suite</a>
```

Add route in `src/dashboard/routes.ts`:

```typescript
// Test suite view
server.get<{ Querystring: { token: string } }>('/dashboard/test-suite', async (request, reply) => {
  const { token } = request.query;

  const allCaptures = await storage.listAllCaptures();

  // Golden tests = human_verified captures that aren't retired
  const goldenTests = allCaptures.filter(c =>
    c.verificationState === 'human_verified' && !c.retiredFromTests
  );

  // Group by route
  const byRoute = new Map<string, typeof goldenTests>();
  for (const capture of goldenTests) {
    const routeId = capture.routeFinal || 'unrouted';
    if (!byRoute.has(routeId)) {
      byRoute.set(routeId, []);
    }
    byRoute.get(routeId)!.push(capture);
  }

  const routes = await storage.listRoutes();
  const routeNames = new Map(routes.map(r => [r.id, r.name]));

  const content = `
    <h1>Test Suite</h1>
    <p class="text-muted" style="margin-bottom: 1rem;">
      ${goldenTests.length} verified captures serve as regression tests for routing changes.
    </p>

    ${Array.from(byRoute.entries()).map(([routeId, captures]) => `
      <div class="card">
        <h3>${routeNames.get(routeId) || routeId} (${captures.length} tests)</h3>
        <table>
          <thead>
            <tr>
              <th>Input</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${captures.slice(0, 10).map(c => `
              <tr>
                <td class="text-truncate">${escapeHtml(c.raw)}</td>
                <td class="text-muted">${formatDate(c.timestamp)}</td>
                <td>
                  <a href="/dashboard/captures/${c.id}?token=${token}" class="btn btn-secondary">View</a>
                  <form method="post" action="/dashboard/captures/${c.id}/retire?token=${token}" style="display: inline;">
                    <button type="submit" class="btn btn-danger" onclick="return confirm('Retire this test case?')">Retire</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('')}

    ${goldenTests.length === 0 ? '<div class="card"><p class="empty-state">No verified captures yet. Verify captures to add them to the test suite.</p></div>' : ''}
  `;

  reply.type('text/html').send(layout('Test Suite', content, token));
});

// Retire capture from test suite
server.post<{
  Params: { captureId: string };
  Querystring: { token: string };
}>('/dashboard/captures/:captureId/retire', async (request, reply) => {
  const { captureId } = request.params;
  const { token } = request.query;

  const capture = await storage.getCapture(captureId);
  if (!capture) {
    return reply.code(404).send({ error: 'Capture not found' });
  }

  capture.retiredFromTests = true;
  capture.retiredReason = 'Retired via dashboard';
  await storage.updateCapture(capture);

  reply.redirect(`/dashboard/test-suite?token=${token}`);
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm test:e2e tests/e2e/dashboard.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/routes.ts src/dashboard/templates.ts tests/e2e/dashboard.spec.ts
git commit -m "feat(dashboard): add test suite view

- Shows human_verified captures as golden tests
- Grouped by route
- Retire button to remove outdated tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Final Integration and Cleanup

**Files:**
- Run all tests to ensure everything works together
- Update beads issues

**Step 1: Run full test suite**

```bash
pnpm build
pnpm test
pnpm test:e2e
```

Expected: All tests pass

**Step 2: Close beads issues**

```bash
bd close slapture-0kr slapture-az5 slapture-42g slapture-byg slapture-2bn slapture-z9s slapture-usx
bd update slapture-ik0 --status=in_progress
```

Note: The epic (slapture-ik0) stays open until Phase 3 success criteria are fully validated.

**Step 3: Final commit and sync**

```bash
git status
bd sync
git push
```

---

## Summary

This plan implements the Phase 3 Dashboard features:

| Issue | Feature | Task |
|-------|---------|------|
| slapture-0kr | Capture list view | Task 2 |
| slapture-az5 | Capture detail view | Task 3 |
| slapture-42g | Verify capture flow | Task 3 |
| slapture-byg | Correction flow | Task 6 |
| slapture-2bn | Route management | Task 4 |
| slapture-z9s | Auth status | Task 5 |
| slapture-usx | Test suite view | Task 7 |

The other two issues (slapture-4j4 Timezone handling, slapture-m9j Per-route context) are P3 and not part of Phase 3 core - they can be addressed separately.
