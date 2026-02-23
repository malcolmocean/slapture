// src/index.ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { buildServer } from './server/index.js';
import { Storage } from './storage/index.js';
import { FirestoreStorage } from './storage/firestore.js';
import { FileSheetsAuthProvider } from './integrations/sheets/auth.js';
import { FirestoreSheetsAuthProvider } from './integrations/sheets/firestore-auth.js';
import type { StorageInterface } from './storage/interface.js';
import type { SheetsAuthProvider } from './integrations/sheets/types.js';

const PORT = parseInt(process.env.PORT || '4444', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const FILESTORE_DIR = process.env.FILESTORE_DIR || './filestore';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'local';

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  let storage: StorageInterface;
  let sheetsAuthProvider: SheetsAuthProvider;

  if (STORAGE_BACKEND === 'firestore') {
    console.log('[Storage] Using Firestore backend');
    const firestoreStorage = new FirestoreStorage();
    storage = firestoreStorage;

    // Initialize Firebase Admin SDK
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('[Auth] Firebase Admin SDK initialized');

    const sheetsClientId = process.env.GOOGLE_SHEETS_CLIENT_ID || '';
    const sheetsClientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET || '';
    sheetsAuthProvider = new FirestoreSheetsAuthProvider(
      firestoreStorage.db,
      sheetsClientId,
      sheetsClientSecret
    );
  } else {
    console.log('[Storage] Using local filesystem backend');
    const fsStorage = new Storage(DATA_DIR);
    await fsStorage.migrateGlobalTokensIfNeeded();
    storage = fsStorage;
    sheetsAuthProvider = new FileSheetsAuthProvider();
  }

  const useFirebaseAuth = STORAGE_BACKEND === 'firestore';
  const app = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY, sheetsAuthProvider, useFirebaseAuth);

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0',
  }, () => {
    console.log(`Slapture server running on http://localhost:${PORT}`);
  });
}

main();
