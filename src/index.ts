// src/index.ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { buildServer } from './server/index.js';
import { Storage } from './storage/index.js';

const PORT = parseInt(process.env.PORT || '4444', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const FILESTORE_DIR = process.env.FILESTORE_DIR || './filestore';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const storage = new Storage(DATA_DIR);
  await storage.migrateGlobalTokensIfNeeded();
  const app = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY);

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0',
  }, () => {
    console.log(`Slapture server running on http://localhost:${PORT}`);
  });
}

main();
