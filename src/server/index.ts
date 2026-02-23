// src/server/index.ts
import { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import type { SheetsAuthProvider } from '../integrations/sheets/types.js';
import { CapturePipeline } from '../pipeline/index.js';
import { buildOAuthRoutes } from './oauth.js';
import { buildDashboardRoutes } from '../dashboard/routes.js';
import path from 'path';
import fs from 'fs';

export async function buildServer(
  storage: StorageInterface,
  filestoreRoot: string,
  apiKey: string,
  sheetsAuthProvider?: SheetsAuthProvider,
  useFirebaseAuth: boolean = false,
): Promise<Hono> {
  const app = new Hono();

  const pipeline = new CapturePipeline(storage, filestoreRoot, apiKey, undefined, sheetsAuthProvider);

  // Auth middleware
  if (useFirebaseAuth) {
    // Firebase Auth + API key middleware
    const { createAuthMiddleware } = await import('./auth.js');
    app.use('*', createAuthMiddleware(storage, {
      publicPaths: ['/', '/login', '/signup', '/widget'],
    }));
  } else {
    // Legacy token-based auth for local development
    app.use('*', async (c, next) => {
      const pathname = new URL(c.req.url).pathname;

      // Skip auth for widget
      if (pathname === '/widget' || pathname.startsWith('/widget/')) {
        return next();
      }

      // Skip auth for OAuth routes (public endpoints)
      if (pathname.startsWith('/connect/') ||
          pathname.startsWith('/oauth/') ||
          pathname.startsWith('/auth/status/') ||
          pathname.startsWith('/disconnect/')) {
        return next();
      }

      const token = c.req.query('token');
      const config = await storage.getConfig();

      if (token !== config.authToken) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      return next();
    });
  }

  // POST /capture
  app.post('/capture', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { text } = body;
    // Use authenticated uid if available, fall back to body username for legacy mode
    const username = c.get('auth')?.uid ?? body.username ?? 'default';

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'text is required' }, 400);
    }

    const result = await pipeline.process(text, username);

    return c.json({
      captureId: result.capture.id,
      status: result.capture.executionResult,
      routeFinal: result.capture.routeFinal,
      needsClarification: result.needsClarification,
    });
  });

  // GET /status/:captureId
  app.get('/status/:captureId', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId);
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404);
    }

    let routeDisplayName: string | null = null;
    if (capture.routeFinal) {
      const route = await storage.getRoute(capture.routeFinal);
      if (route) {
        if (route.destinationType === 'fs') {
          const operation = route.transformScript?.includes('appendFileSync') ? 'append' : 'write';
          routeDisplayName = `${operation}-${(route.destinationConfig as { filePath: string }).filePath}`;
        } else {
          routeDisplayName = `${route.destinationType}-${route.name}`;
        }
      }
    }

    return c.json({ ...capture, routeDisplayName });
  });

  // GET /routes
  app.get('/routes', async (c) => {
    return c.json(await storage.listRoutes());
  });

  // GET /captures
  app.get('/captures', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    return c.json(await storage.listCaptures(limit));
  });

  // GET /captures/blocked
  app.get('/captures/blocked', async (c) => {
    return c.json(await storage.listCapturesNeedingAuth());
  });

  // POST /retry/:captureId
  app.post('/retry/:captureId', async (c) => {
    const captureId = c.req.param('captureId');

    const capture = await storage.getCapture(captureId);
    if (!capture) {
      return c.json({ error: 'Capture not found' }, 404);
    }

    if (capture.executionResult !== 'blocked_needs_auth' &&
        capture.executionResult !== 'blocked_auth_expired') {
      return c.json({
        error: 'Capture is not blocked',
        currentStatus: capture.executionResult
      }, 400);
    }

    const result = await pipeline.retryCapture(capture);
    return c.json({ capture: result.capture });
  });

  // GET /widget
  app.get('/widget', async (c) => {
    const widgetPath = path.join(process.cwd(), 'src', 'widget', 'index.html');

    if (!fs.existsSync(widgetPath)) {
      return c.text(`Widget not found at ${widgetPath}`, 404);
    }

    const html = fs.readFileSync(widgetPath, 'utf-8');
    return c.html(html);
  });

  // OAuth routes
  buildOAuthRoutes(app, storage, {
    intendClientId: process.env.INTEND_CLIENT_ID || '',
    intendClientSecret: process.env.INTEND_CLIENT_SECRET || '',
    intendBaseUrl: process.env.INTEND_BASE_URL || 'https://intend.do',
    callbackBaseUrl: process.env.CALLBACK_BASE_URL || 'http://localhost:4444'
  });

  // Dashboard routes
  buildDashboardRoutes(app, storage);

  return app;
}
