import type { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import { layout, escapeHtml, formatDate, statusBadge, verificationBadge, renderPipeline } from './templates.js';
import { getIntegrationsWithStatus } from '../integrations/registry.js';

export function buildDashboardRoutes(app: Hono, storage: StorageInterface): void {
  // Dashboard home
  app.get('/dashboard', async (c) => {
    const [captures, routes, blocked] = await Promise.all([
      storage.listCaptures(10, c.get('auth')?.uid),
      storage.listRoutes(),
      storage.listCapturesNeedingAuth(c.get('auth')?.uid),
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
          <p style="margin-top: 1rem;"><a href="/dashboard/captures">View all captures →</a></p>
        `}
      </div>
    `;

    return c.html(layout('Home', content));
  });

  // Captures list
  app.get('/dashboard/captures', async (c) => {
    const status = c.req.query('status');
    const search = c.req.query('search');
    const pageStr = c.req.query('page');
    const page = parseInt(pageStr || '1', 10);
    const perPage = 25;

    let captures = await storage.listAllCaptures(c.get('auth')?.uid);

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
                    <a href="/dashboard/captures/${c.id}" class="btn btn-secondary">View</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          ${totalPages > 1 ? `
            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: center;">
              ${page > 1 ? `<a href="/dashboard/captures?status=${status || 'all'}&search=${encodeURIComponent(search || '')}&page=${page - 1}" class="btn btn-secondary">← Prev</a>` : ''}
              <span style="padding: 0.5rem;">Page ${page} of ${totalPages}</span>
              ${page < totalPages ? `<a href="/dashboard/captures?status=${status || 'all'}&search=${encodeURIComponent(search || '')}&page=${page + 1}" class="btn btn-secondary">Next →</a>` : ''}
            </div>
          ` : ''}
        `}
      </div>
    `;

    return c.html(layout('Captures', content));
  });

  // Capture detail
  app.get('/dashboard/captures/:captureId', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId, c.get('auth')?.uid);
    if (!capture) {
      return c.html(layout('Not Found', '<h1>Capture not found</h1>'), 404);
    }

    const route = capture.routeFinal ? await storage.getRoute(capture.routeFinal) : null;

    const content = `
      <h1>Capture Detail</h1>

      <div class="card">
        <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; margin-bottom: 0.75rem;">${escapeHtml(capture.raw)}</pre>
        <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
          <span class="text-muted">${formatDate(capture.timestamp)}</span>
          ${statusBadge(capture.executionResult)}
          ${verificationBadge(capture.verificationState)}
          ${route ? `<a href="/dashboard/routes/${route.id}" style="text-decoration: none;"><strong>${escapeHtml(route.name)}</strong></a>` : capture.routeFinal ? `<code>${escapeHtml(capture.routeFinal)}</code>` : ''}
          ${capture.routeConfidence ? `<span class="text-muted">${capture.routeConfidence} confidence</span>` : ''}
          <span class="text-muted" style="font-size: 0.75rem;"><code>${capture.id}</code></span>
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap;">
          ${capture.verificationState !== 'human_verified' ? `
            <form method="post" action="/dashboard/captures/${captureId}/verify" style="margin: 0;">
              <button type="submit" class="btn btn-primary">Verify Correct</button>
            </form>
            <a href="/dashboard/captures/${captureId}/correct" class="btn btn-secondary">This was wrong</a>
          ` : ''}
          ${['blocked_needs_auth', 'blocked_auth_expired'].includes(capture.executionResult) ? `
            <form method="post" action="/retry/${captureId}" style="margin: 0;">
              <button type="submit" class="btn btn-secondary">Retry</button>
            </form>
          ` : ''}
        </div>
      </div>

      ${renderPipeline(capture.executionTrace, route)}

      <p style="margin-top: 1rem;">
        <a href="/dashboard/captures">← Back to captures</a>
      </p>
    `;

    return c.html(layout('Capture Detail', content));
  });

  // Verify capture
  app.post('/dashboard/captures/:captureId/verify', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId, c.get('auth')?.uid);
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404);
    }

    capture.verificationState = 'human_verified';
    await storage.updateCapture(capture);

    return c.redirect(`/dashboard/captures/${captureId}`);
  });

  // Routes list
  app.get('/dashboard/routes', async (c) => {
    const routes = await storage.listRoutes();
    const allCaptures = await storage.listAllCaptures(c.get('auth')?.uid);

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
                    <a href="/dashboard/routes/${r.id}" class="btn btn-secondary">View</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    return c.html(layout('Routes', content));
  });

  // Route detail
  app.get('/dashboard/routes/:routeId', async (c) => {
    const routeId = c.req.param('routeId');

    const route = await storage.getRoute(routeId);
    if (!route) {
      return c.html(layout('Not Found', '<h1>Route not found</h1>'), 404);
    }

    const allCaptures = await storage.listAllCaptures(c.get('auth')?.uid);
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
                  <td class="text-truncate"><a href="/dashboard/captures/${c.id}">${escapeHtml(c.raw)}</a></td>
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
        <a href="/dashboard/routes">← Back to routes</a>
      </p>
    `;

    return c.html(layout(route.name, content));
  });

  // Auth status page
  app.get('/dashboard/auth', async (c) => {
    const auth = c.get('auth');
    const integrations = await getIntegrationsWithStatus(storage, auth.uid);
    const blocked = await storage.listCapturesNeedingAuth(auth.uid);

    const statusBadgeMap: Record<string, string> = {
      connected: 'badge-success',
      expired: 'badge-danger',
      'never': 'badge-warning',
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
                      <form method="post" action="/disconnect/${i.id}?redirect=/dashboard/auth" style="display: inline;">
                        <button type="submit" class="btn btn-danger">Disconnect</button>
                      </form>
                    ` : `
                      <a href="/connect/${i.id}" class="btn btn-primary">Connect</a>
                    `}
                  ` : i.id === 'roam' ? `
                    <a href="/dashboard/roam" class="btn btn-secondary">Settings</a>
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
                <th>Route</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${blocked.map(c => `
                <tr>
                  <td>${formatDate(c.timestamp)}</td>
                  <td class="text-truncate">${escapeHtml(c.raw)}</td>
                  <td>${escapeHtml(c.routeFinal || '-')}</td>
                  <td>${statusBadge(c.executionResult)}</td>
                  <td>
                    <a href="/dashboard/captures/${c.id}" class="btn btn-secondary">View</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    return c.html(layout('Auth Status', content));
  });

  // Roam settings page
  app.get('/dashboard/roam', async (c) => {
    const auth = c.get('auth');
    const roamConfig = await storage.getRoamConfig(auth.uid);
    const error = c.req.query('error');

    const errorBanner = error ? `
      <div class="card" style="background: #fee; border-left: 4px solid #c00; margin-bottom: 1rem;">
        <p style="margin: 0; color: #c00;">
          ${error === 'connection_failed' ? 'Failed to connect — check your graph name and token.' :
            error === 'missing_fields' ? 'Please fill in both graph name and token.' :
            'An error occurred.'}
        </p>
      </div>
    ` : '';

    const content = `
      <h1>Roam Research Settings</h1>
      <p><a href="/dashboard/auth">&larr; Back to Auth Status</a></p>

      ${errorBanner}

      <div class="card">
        <h3>Connected Graphs</h3>
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
                    <form method="post" action="/disconnect/roam/${encodeURIComponent(g.graphName)}?redirect=/dashboard/roam" style="display: inline;">
                      <button type="submit" class="btn btn-danger">Remove</button>
                    </form>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p class="text-muted">No graphs connected yet.</p>'}
      </div>

      <div class="card">
        <h3>Add Graph</h3>
        <p class="text-muted">Create an API token in Roam: Settings &rarr; Graph &rarr; API tokens.</p>
        <form id="roam-connect-form" method="post" action="/connect/roam">
          <div style="display: flex; gap: 0.5rem; align-items: flex-end; flex-wrap: wrap;">
            <div>
              <label for="graphName">Graph Name</label>
              <input type="text" id="graphName" name="graphName" placeholder="my-graph" required style="width: 200px;">
            </div>
            <div>
              <label for="token">API Token</label>
              <input type="password" id="token" name="token" placeholder="roam-graph-token-..." required style="width: 300px;">
            </div>
            <button type="submit" id="roam-connect-btn" class="btn btn-primary">Connect</button>
          </div>
        </form>
      </div>

      <script>
        document.getElementById('roam-connect-form').addEventListener('submit', function() {
          var btn = document.getElementById('roam-connect-btn');
          btn.disabled = true;
          btn.textContent = 'Connecting...';
          btn.style.opacity = '0.7';
        });
      </script>
    `;

    return c.html(layout('Roam Settings', content));
  });

  // Correction page
  app.get('/dashboard/captures/:captureId/correct', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId, c.get('auth')?.uid);
    if (!capture) {
      return c.html(layout('Not Found', '<h1>Capture not found</h1>'), 404);
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
        <form method="post" action="/dashboard/captures/${captureId}/correct">
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
            <a href="/dashboard/captures/${captureId}" class="btn btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    `;

    return c.html(layout('Correct Capture', content));
  });

  // Submit correction
  app.post('/dashboard/captures/:captureId/correct', async (c) => {
    const captureId = c.req.param('captureId');
    const body = await c.req.parseBody() as Record<string, string>;
    const correctRoute = body.correctRoute;
    const reason = body.reason;

    const capture = await storage.getCapture(captureId, c.get('auth')?.uid);
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404);
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

    return c.redirect(`/dashboard/captures/${captureId}`);
  });

  // Test suite view
  app.get('/dashboard/test-suite', async (c) => {
    const allCaptures = await storage.listAllCaptures(c.get('auth')?.uid);

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
                    <a href="/dashboard/captures/${c.id}" class="btn btn-secondary">View</a>
                    <form method="post" action="/dashboard/captures/${c.id}/retire" style="display: inline;">
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

    return c.html(layout('Test Suite', content));
  });

  // Retire capture from test suite
  app.post('/dashboard/captures/:captureId/retire', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId, c.get('auth')?.uid);
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404);
    }

    capture.retiredFromTests = true;
    capture.retiredReason = 'Retired via dashboard';
    await storage.updateCapture(capture);

    return c.redirect(`/dashboard/test-suite`);
  });

  // Trigger Change Reviews list
  app.get('/dashboard/reviews', async (c) => {
    const status = c.req.query('status');

    const filterStatus = status === 'all' ? undefined : (status as 'pending' | 'approved' | 'rejected' | undefined) || 'pending';
    const reviews = await storage.listTriggerReviews(filterStatus);
    const routes = await storage.listRoutes();
    const routeNames = new Map(routes.map(r => [r.id, r.name]));

    const statuses = ['pending', 'approved', 'rejected', 'all'];

    const reviewBadgeClass = (s: string) => ({
      pending: 'badge-warning',
      approved: 'badge-success',
      rejected: 'badge-danger',
    }[s] || 'badge-secondary');

    const content = `
      <h1>Trigger Change Reviews</h1>
      <p class="text-muted" style="margin-bottom: 1rem;">
        Reviews are created when the evolver proposes trigger changes that would affect human-verified captures.
      </p>

      <form class="filter-bar" method="get" action="/dashboard/reviews">
        <select name="status" onchange="this.form.submit()">
          ${statuses.map(s => `<option value="${s}" ${(status || 'pending') === s ? 'selected' : ''}>${s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
      </form>

      <div class="card">
        ${reviews.length === 0 ? '<p class="empty-state">No trigger change reviews</p>' : `
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Created</th>
                <th>Affected Captures</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${reviews.map(r => `
                <tr>
                  <td><strong>${escapeHtml(routeNames.get(r.routeId) || r.routeId)}</strong></td>
                  <td>${formatDate(r.createdAt)}</td>
                  <td>${r.affectedCaptures.length}</td>
                  <td><span class="badge ${reviewBadgeClass(r.status)}">${r.status}</span></td>
                  <td>
                    <a href="/dashboard/reviews/${r.id}" class="btn btn-secondary">View</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;

    return c.html(layout('Trigger Reviews', content));
  });

  // Review detail
  app.get('/dashboard/reviews/:reviewId', async (c) => {
    const reviewId = c.req.param('reviewId');

    const review = await storage.getTriggerReview(reviewId);
    if (!review) {
      return c.html(layout('Not Found', '<h1>Review not found</h1>'), 404);
    }

    const route = await storage.getRoute(review.routeId);
    const routes = await storage.listRoutes();
    const routeNames = new Map(routes.map(r => [r.id, r.name]));

    const actionBadgeClass = (action: string) => ({
      RE_ROUTE: 'badge-info',
      MARK_FOR_REVIEW: 'badge-warning',
      LEAVE_AS_HISTORICAL: 'badge-secondary',
    }[action] || 'badge-secondary');

    const content = `
      <h1>Trigger Change Review</h1>

      <div class="card">
        <h3>Overview</h3>
        <table>
          <tr><td><strong>Route</strong></td><td><a href="/dashboard/routes/${review.routeId}">${escapeHtml(route?.name || review.routeId)}</a></td></tr>
          <tr><td><strong>Status</strong></td><td><span class="badge ${review.status === 'pending' ? 'badge-warning' : review.status === 'approved' ? 'badge-success' : 'badge-danger'}">${review.status}</span></td></tr>
          <tr><td><strong>Created</strong></td><td>${formatDate(review.createdAt)}</td></tr>
        </table>
      </div>

      <div class="card">
        <h3>Evolver Reasoning</h3>
        <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(review.evolverReasoning)}</pre>
      </div>

      <div class="card">
        <h3>Proposed Triggers</h3>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Pattern</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${review.proposedTriggers.map(t => `
              <tr>
                <td><span class="badge badge-secondary">${t.type}</span></td>
                <td><code>${escapeHtml(t.pattern)}</code></td>
                <td>${t.priority}</td>
                <td><span class="badge ${t.status === 'draft' ? 'badge-warning' : 'badge-success'}">${t.status || 'live'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>Affected Captures (${review.affectedCaptures.length})</h3>
        ${review.affectedCaptures.length === 0 ? '<p class="text-muted">No affected captures</p>' : `
          <table>
            <thead>
              <tr>
                <th>Input</th>
                <th>Routed</th>
                <th>Recommendation</th>
                <th>Suggested Route</th>
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              ${review.affectedCaptures.map(c => `
                <tr>
                  <td class="text-truncate" title="${escapeHtml(c.raw)}">${escapeHtml(c.raw)}</td>
                  <td>${formatDate(c.routedAt)}</td>
                  <td><span class="badge ${actionBadgeClass(c.recommendation)}">${c.recommendation}</span></td>
                  <td>${c.suggestedReroute ? escapeHtml(routeNames.get(c.suggestedReroute) || c.suggestedReroute) : '-'}</td>
                  <td class="text-truncate" title="${escapeHtml(c.reasoning)}">${escapeHtml(c.reasoning)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      ${review.status === 'pending' ? `
        <div class="card">
          <h3>Actions</h3>
          <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
            <form method="post" action="/dashboard/reviews/${review.id}/approve" style="margin: 0;">
              <button type="submit" class="btn btn-primary" onclick="return confirm('Approve these trigger changes?')">Approve Changes</button>
            </form>
            <form method="post" action="/dashboard/reviews/${review.id}/reject" style="margin: 0;">
              <button type="submit" class="btn btn-danger" onclick="return confirm('Reject these trigger changes?')">Reject Changes</button>
            </form>
          </div>
        </div>
      ` : ''}

      <p style="margin-top: 1rem;">
        <a href="/dashboard/reviews">← Back to reviews</a>
      </p>
    `;

    return c.html(layout('Review Detail', content));
  });

  // Approve review
  app.post('/dashboard/reviews/:reviewId/approve', async (c) => {
    const reviewId = c.req.param('reviewId');

    const review = await storage.getTriggerReview(reviewId);
    if (!review) {
      return c.json({ error: 'Review not found' }, 404);
    }

    // Apply trigger changes to the route
    const route = await storage.getRoute(review.routeId);
    if (route) {
      route.triggers = review.proposedTriggers;
      await storage.saveRoute(route);
    }

    // Process affected captures according to recommendations
    for (const affected of review.affectedCaptures) {
      const capture = await storage.getCapture(affected.captureId, c.get('auth')?.uid);
      if (!capture) continue;

      switch (affected.recommendation) {
        case 'RE_ROUTE':
          capture.routeFinal = null;
          capture.routeProposed = affected.suggestedReroute || null;
          capture.verificationState = 'pending';
          capture.executionResult = 'pending';
          break;

        case 'LEAVE_AS_HISTORICAL':
          capture.retiredFromTests = true;
          capture.retiredReason = `Retired during review approval: ${affected.reasoning}`;
          break;

        case 'MARK_FOR_REVIEW':
          capture.routingReviewQueued = true;
          capture.suggestedReroute = affected.suggestedReroute || null;
          break;
      }

      await storage.updateCapture(capture);
    }

    // Update review status
    await storage.updateTriggerReviewStatus(reviewId, 'approved');

    return c.redirect(`/dashboard/reviews/${reviewId}`);
  });

  // Reject review
  app.post('/dashboard/reviews/:reviewId/reject', async (c) => {
    const reviewId = c.req.param('reviewId');

    const review = await storage.getTriggerReview(reviewId);
    if (!review) {
      return c.json({ error: 'Review not found' }, 404);
    }

    // Just update status - don't apply any changes
    await storage.updateTriggerReviewStatus(reviewId, 'rejected');

    return c.redirect(`/dashboard/reviews/${reviewId}`);
  });
}
