# Cloud Migration Plan — Addendum: Google Sheets Integration

> **Context:** The gsheets branch was merged into main before executing the cloud migration plan. This addendum describes changes to Tasks 8-10 to account for the `SheetsAuthProvider` abstraction and `SheetsExecutor` that now exist in the codebase.

---

### Task 8 (amended): Extract StorageInterface type

**No changes to the StorageInterface itself** — sheets auth is handled by `SheetsAuthProvider` (in `src/integrations/sheets/types.ts`), not by `StorageInterface`. The existing plan for Task 8 is correct as-is.

However, note that `src/integrations/sheets/types.ts` already defines:

```typescript
export interface SheetsAuthProvider {
  getCredentials(userId: string): Promise<SheetsCredentials | null>;
}

export interface SheetsCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}
```

And `FileSheetsAuthProvider` (in `src/integrations/sheets/auth.ts`) implements it by reading from `./secrets/` with fallback to `./tests/fixtures/google-test-tokens.json`.

---

### Task 9 (amended): Implement FirestoreStorage + FirestoreSheetsAuthProvider

**In addition to** the existing Task 9 plan, also create a `FirestoreSheetsAuthProvider`:

**Additional file:**
- Create: `src/integrations/sheets/firestore-auth.ts`

**Step (insert after FirestoreStorage is written): Write FirestoreSheetsAuthProvider**

```typescript
// src/integrations/sheets/firestore-auth.ts
import { Firestore } from '@google-cloud/firestore';
import type { SheetsAuthProvider, SheetsCredentials } from './types.js';

/**
 * Reads Google Sheets OAuth credentials from Firestore.
 * Stores per-user tokens at users/{userId}/integrations/sheets.
 * Client credentials (client_id, client_secret) come from env vars
 * or Secret Manager (they're app-level, not per-user).
 */
export class FirestoreSheetsAuthProvider implements SheetsAuthProvider {
  private db: Firestore;
  private clientId: string;
  private clientSecret: string;

  constructor(db: Firestore, clientId: string, clientSecret: string) {
    this.db = db;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getCredentials(userId: string): Promise<SheetsCredentials | null> {
    const doc = await this.db.collection('users').doc(userId).get();
    if (!doc.exists) return null;

    const data = doc.data();
    const sheetsTokens = data?.integrations?.sheets;
    if (!sheetsTokens?.accessToken || !sheetsTokens?.refreshToken) return null;

    return {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      accessToken: sheetsTokens.accessToken,
      refreshToken: sheetsTokens.refreshToken,
    };
  }
}
```

**Firestore collection structure addition:**
- `users/{username}` document gains `integrations.sheets` field (alongside existing `integrations.intend`):
  ```json
  {
    "integrations": {
      "intend": { "accessToken": "...", "refreshToken": "...", "expiresAt": "...", "baseUrl": "..." },
      "sheets": { "accessToken": "...", "refreshToken": "..." }
    }
  }
  ```

**Commit this alongside FirestoreStorage:**
```bash
git add src/storage/firestore.ts src/integrations/sheets/firestore-auth.ts package.json pnpm-lock.yaml
git commit -m "feat: add FirestoreStorage backend and FirestoreSheetsAuthProvider"
```

---

### Task 10 (amended): Wire up storage backend switching in entrypoint

**Key change:** `RouteExecutor` now accepts an optional 3rd parameter `sheetsAuthProvider: SheetsAuthProvider`. In local mode it defaults to `FileSheetsAuthProvider()`. In Firestore mode, pass `FirestoreSheetsAuthProvider`.

**Step 1 (updated): Update src/index.ts**

The entrypoint needs to create the right auth provider and pass it through to the server/pipeline:

```typescript
// In the firestore branch of the if/else:
if (STORAGE_BACKEND === 'firestore') {
  console.log('[Storage] Using Firestore backend');
  const firestoreStorage = new FirestoreStorage();
  storage = firestoreStorage;

  // Sheets auth from Firestore — client creds from env/Secret Manager
  const sheetsClientId = process.env.GOOGLE_SHEETS_CLIENT_ID || '';
  const sheetsClientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET || '';
  sheetsAuthProvider = new FirestoreSheetsAuthProvider(
    firestoreStorage.db,  // expose db or pass Firestore instance
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
```

**Step 2 (updated): Thread sheetsAuthProvider through to RouteExecutor**

`buildServer()` signature needs to accept the auth provider and pass it to the pipeline/executor:

```typescript
export async function buildServer(
  storage: StorageInterface,
  filestoreRoot: string,
  apiKey: string,
  sheetsAuthProvider?: SheetsAuthProvider
): Promise<Hono> {
  const pipeline = new CapturePipeline(storage, filestoreRoot, apiKey, sheetsAuthProvider);
  // ...
}
```

`CapturePipeline` passes it to `RouteExecutor`:

```typescript
this.executor = new RouteExecutor(filestoreRoot, storage, sheetsAuthProvider);
```

This is already how `RouteExecutor` is wired — its constructor already accepts the optional 3rd param and defaults to `FileSheetsAuthProvider()`.

**Step 3: Add env vars for Sheets client creds**

Add to `.env.example`:
```
# Google Sheets OAuth (app-level client credentials)
# In cloud: use Secret Manager for these
GOOGLE_SHEETS_CLIENT_ID=
GOOGLE_SHEETS_CLIENT_SECRET=
```

In Cloud Run deployment (Task 13), add these as secrets:
```bash
gcloud run deploy slapture \
  --set-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GOOGLE_SHEETS_CLIENT_ID=GOOGLE_SHEETS_CLIENT_ID:latest,GOOGLE_SHEETS_CLIENT_SECRET=GOOGLE_SHEETS_CLIENT_SECRET:latest"
```

---

### Task 12 (amended): Test Firestore integration locally — including Sheets

**Additional verification step:**

After verifying basic capture flow, also test that Sheets routes work with Firestore storage:

**Step (additional): Seed test sheets credentials into Firestore**

```bash
# Use the Firebase Admin SDK or console to add test tokens to users/default/integrations/sheets
# Or: write a quick script that reads from tests/fixtures/google-test-tokens.json
# and writes to Firestore at users/default
```

**Step (additional): Test a sheets capture**

```bash
./slap.sh "weight 85.0"
```

Expected: Route matches, sheets executor fires, row appended to test spreadsheet.

This is the key e2e validation — it proves the full stack works: Hono → Pipeline → SheetsExecutor → FirestoreSheetsAuthProvider → Google Sheets API.
