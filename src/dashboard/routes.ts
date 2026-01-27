import { FastifyInstance } from 'fastify';
import { Storage } from '../storage/index.js';
import { layout, escapeHtml, formatDate, statusBadge, verificationBadge } from './templates.js';
import { getIntegrationsWithStatus } from '../integrations/registry.js';

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
            <a href="/dashboard/captures/${captureId}/correct?token=${token}" class="btn btn-secondary">This was wrong</a>
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
}
