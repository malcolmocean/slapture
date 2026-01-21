// src/index.ts
import { buildServer } from './server/index.js';
import { Storage } from './storage/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const FILESTORE_DIR = process.env.FILESTORE_DIR || './filestore';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const storage = new Storage(DATA_DIR);
  const server = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY);

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Slapture server running on http://localhost:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
