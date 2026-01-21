// src/server/index.ts
import Fastify, { FastifyInstance } from 'fastify';
import { Storage } from '../storage/index.js';
import { CapturePipeline } from '../pipeline/index.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

export async function buildServer(
  storage: Storage,
  filestoreRoot: string,
  apiKey: string
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  const pipeline = new CapturePipeline(storage, filestoreRoot, apiKey);

  // Auth hook
  server.addHook('onRequest', async (request, reply) => {
    // Skip auth for widget
    if (request.url === '/widget' || request.url.startsWith('/widget/')) {
      return;
    }

    const token = (request.query as Record<string, string>).token;
    const config = await storage.getConfig();

    if (token !== config.authToken) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // POST /capture - Submit a new capture
  server.post<{
    Querystring: { token: string };
    Body: { text: string; username?: string };
  }>('/capture', async (request, reply) => {
    const { text, username = 'default' } = request.body || {};

    if (!text || typeof text !== 'string') {
      return reply.code(400).send({ error: 'text is required' });
    }

    const result = await pipeline.process(text, username);

    return {
      captureId: result.capture.id,
      status: result.capture.executionResult,
      routeFinal: result.capture.routeFinal,
      needsClarification: result.needsClarification,
    };
  });

  // GET /status/:captureId - Get capture status
  server.get<{
    Params: { captureId: string };
    Querystring: { token: string };
  }>('/status/:captureId', async (request, reply) => {
    const { captureId } = request.params;

    const capture = await storage.getCapture(captureId);
    if (!capture) {
      return reply.code(404).send({ error: 'Capture not found' });
    }

    return capture;
  });

  // GET /routes - List all routes
  server.get('/routes', async () => {
    return storage.listRoutes();
  });

  // GET /captures - List recent captures
  server.get<{
    Querystring: { token: string; limit?: string };
  }>('/captures', async (request) => {
    const limit = parseInt(request.query.limit || '50', 10);
    return storage.listCaptures(limit);
  });

  // GET /widget - Serve web widget
  server.get('/widget', async (request, reply) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const widgetPath = path.join(__dirname, '..', 'widget', 'index.html');

    if (!fs.existsSync(widgetPath)) {
      return reply.code(404).send('Widget not found');
    }

    const html = fs.readFileSync(widgetPath, 'utf-8');
    reply.type('text/html').send(html);
  });

  return server;
}
