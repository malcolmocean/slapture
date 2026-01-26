import { FastifyInstance } from 'fastify';
import { Storage } from '../storage/index.js';
import { layout, escapeHtml, formatDate, statusBadge } from './templates.js';

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
