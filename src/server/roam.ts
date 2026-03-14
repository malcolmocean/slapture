// src/server/roam.ts
import type { Hono } from 'hono';
import type { StorageInterface } from '../storage/interface.js';
import { RoamClient } from '../integrations/roam/client.js';

export function buildRoamRoutes(app: Hono, storage: StorageInterface): void {

  // JSON API: connect a Roam graph
  app.post('/api/roam/connect', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const { graphName, token } = await c.req.json();
    if (!graphName || !token) {
      return c.json({ error: 'graphName and token are required' }, 400);
    }

    try {
      const client = new RoamClient(graphName, token);
      await client.getAllPageTitles();
    } catch (err) {
      console.error('[Roam] Connection test failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Connection failed: ${message}` }, 400);
    }

    const existing = await storage.getRoamConfig(auth.uid);
    const graphs = existing?.graphs?.filter(g => g.graphName !== graphName) || [];
    graphs.push({
      graphName,
      token,
      addedAt: new Date().toISOString(),
    });

    await storage.saveRoamConfig(auth.uid, { graphs });
    console.log(`[Roam] Graph "${graphName}" connected for user: ${auth.uid}`);

    return c.json({ success: true, graphName });
  });

  // JSON API: disconnect a Roam graph
  app.delete('/api/roam/disconnect/:graphName', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const graphName = c.req.param('graphName');
    const existing = await storage.getRoamConfig(auth.uid);
    if (!existing) {
      return c.json({ success: true });
    }

    const remaining = existing.graphs.filter(g => g.graphName !== graphName);
    if (remaining.length === 0) {
      await storage.clearRoamConfig(auth.uid);
    } else {
      await storage.saveRoamConfig(auth.uid, { graphs: remaining });
    }

    console.log(`[Roam] Graph "${graphName}" disconnected for user: ${auth.uid}`);
    return c.json({ success: true });
  });

  // Form-based: connect a Roam graph (dashboard)
  app.post('/connect/roam', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.redirect('/login');
    }

    const body = await c.req.parseBody() as Record<string, string>;
    const graphName = body.graphName;
    const token = body.token;

    if (!graphName || !token) {
      return c.redirect('/dashboard/roam?error=missing_fields');
    }

    try {
      const client = new RoamClient(graphName, token);
      await client.getAllPageTitles();
    } catch (err) {
      console.error('[Roam] Connection test failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      return c.redirect('/dashboard/roam?error=connection_failed');
    }

    const existing = await storage.getRoamConfig(auth.uid);
    const graphs = existing?.graphs?.filter(g => g.graphName !== graphName) || [];
    graphs.push({
      graphName,
      token,
      addedAt: new Date().toISOString(),
    });

    await storage.saveRoamConfig(auth.uid, { graphs });
    console.log(`[Roam] Graph "${graphName}" connected for user: ${auth.uid}`);

    return c.redirect('/dashboard/roam');
  });

  // Form-based: disconnect a Roam graph (dashboard)
  app.post('/disconnect/roam/:graphName', async (c) => {
    const auth = c.get('auth');
    if (!auth?.uid) {
      return c.redirect('/login');
    }

    const graphName = c.req.param('graphName');
    const existing = await storage.getRoamConfig(auth.uid);

    if (existing) {
      const remaining = existing.graphs.filter(g => g.graphName !== graphName);
      if (remaining.length === 0) {
        await storage.clearRoamConfig(auth.uid);
      } else {
        await storage.saveRoamConfig(auth.uid, { graphs: remaining });
      }
    }

    console.log(`[Roam] Graph "${graphName}" disconnected for user: ${auth.uid}`);

    const redirect = c.req.query('redirect');
    if (redirect) {
      return c.redirect(redirect);
    }
    return c.redirect('/dashboard/auth');
  });
}
