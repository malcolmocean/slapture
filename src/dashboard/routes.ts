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
}
