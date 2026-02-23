// src/server/index.ts
import { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import type { SheetsAuthProvider } from '../integrations/sheets/types.js';
import { CapturePipeline } from '../pipeline/index.js';
import { buildOAuthRoutes } from './oauth.js';
import { buildDashboardRoutes } from '../dashboard/routes.js';
import { getAuth } from 'firebase-admin/auth';
import path from 'path';
import fs from 'fs';

export async function buildServer(
  storage: StorageInterface,
  filestoreRoot: string,
  apiKey: string,
  sheetsAuthProvider?: SheetsAuthProvider,
): Promise<Hono> {
  const app = new Hono();

  const pipeline = new CapturePipeline(storage, filestoreRoot, apiKey, undefined, sheetsAuthProvider);

  // Firebase client config (for login/signup pages)
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  };

  // Public pages
  const { renderLandingPage } = await import('../pages/landing.js');
  const { renderLoginPage } = await import('../pages/login.js');
  const { renderSignupPage } = await import('../pages/signup.js');

  app.get('/', (c) => c.html(renderLandingPage()));
  app.get('/login', (c) => c.html(renderLoginPage(firebaseConfig)));
  app.get('/secret-signup', (c) => c.html(renderSignupPage(firebaseConfig)));

  // Session endpoint for dashboard cookie auth
  app.post('/api/session', async (c) => {
    const { idToken, signup } = await c.req.json();

    // Check if user exists — reject new accounts unless via signup page
    const decoded = await getAuth().verifyIdToken(idToken);
    const existingUser = await storage.getUser(decoded.uid);
    if (!existingUser && !signup) {
      return c.json({ error: 'No account found. Please sign up first.' }, 403);
    }

    // Auto-create user on signup
    if (!existingUser && signup) {
      await storage.saveUser({
        uid: decoded.uid,
        email: decoded.email || '',
        displayName: decoded.name || decoded.email?.split('@')[0] || 'User',
        createdAt: new Date().toISOString(),
        authProvider: decoded.firebase?.sign_in_provider === 'google.com' ? 'google' : 'email',
      });
    }

    c.header('Set-Cookie', `__session=${idToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`);
    return c.json({ ok: true });
  });

  // Firebase Auth + API key middleware
  const { createAuthMiddleware } = await import('./auth.js');
  app.use('*', createAuthMiddleware(storage, {
    publicPaths: ['/', '/login', '/secret-signup', '/widget', '/api/session'],
  }));

  // POST /capture
  app.post('/capture', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { text } = body;
    const username = c.get('auth')?.uid ?? 'default';

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

  // API key management routes
  const { buildApiKeyRoutes } = await import('./api-keys.js');
  buildApiKeyRoutes(app, storage);

  return app;
}
