# Firebase Auth Migration + Intend Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove legacy token-based auth, make dashboard/OAuth use Firebase session cookies, and get Intend integration working end-to-end with Playwright tests.

**Architecture:** Strip the `useFirebaseAuth` conditional from the server. Always use Firebase auth middleware. Dashboard links drop `?token=` (cookie handles auth). OAuth routes read user from `c.get('auth').uid` instead of `?user=` query param. Widget drops `?token=` fallback.

**Tech Stack:** Hono, Firebase Auth, Playwright, Firestore

---

### Task 1: Remove `useFirebaseAuth` flag from server entrypoint

**Files:**
- Modify: `src/index.ts:55-56`
- Modify: `src/server/index.ts:17` (function signature)

**Step 1: Remove `useFirebaseAuth` variable and parameter**

In `src/index.ts`, remove line 55 (`const useFirebaseAuth = ...`) and change line 56 to not pass `useFirebaseAuth`:
```typescript
const app = await buildServer(storage, FILESTORE_DIR, ANTHROPIC_API_KEY, sheetsAuthProvider);
```

In `src/server/index.ts`, remove the `useFirebaseAuth` parameter from `buildServer()`:
```typescript
export async function buildServer(
  storage: StorageInterface,
  filestoreRoot: string,
  apiKey: string,
  sheetsAuthProvider?: SheetsAuthProvider,
): Promise<Hono> {
```

**Step 2: Remove the legacy auth `else` branch**

In `src/server/index.ts`, replace lines 67-101 (the `if (useFirebaseAuth) { ... } else { ... }` block for auth middleware) with just the Firebase auth path — no conditional:

```typescript
  // Firebase Auth + API key middleware
  const { createAuthMiddleware } = await import('./auth.js');
  app.use('*', createAuthMiddleware(storage, {
    publicPaths: ['/', '/login', '/secret-signup', '/widget', '/api/session'],
  }));
```

Also replace lines 31-65 (the `if (useFirebaseAuth)` block for public pages) — remove the conditional, always register these pages:

```typescript
  // Public pages
  const { renderLandingPage } = await import('../pages/landing.js');
  const { renderLoginPage } = await import('../pages/login.js');
  const { renderSignupPage } = await import('../pages/signup.js');

  app.get('/', (c) => c.html(renderLandingPage()));
  app.get('/login', (c) => c.html(renderLoginPage(firebaseConfig)));
  app.get('/secret-signup', (c) => c.html(renderSignupPage(firebaseConfig)));

  // Session endpoint
  app.post('/api/session', async (c) => {
    // ... unchanged session logic ...
  });
```

Similarly for the API key routes block (lines 209-213), remove the `if (useFirebaseAuth)` conditional — always register them.

**Step 3: Also require Firebase init for all backends**

In `src/index.ts`, Firebase Admin SDK is only initialized in the `if (STORAGE_BACKEND === 'firestore')` branch. Move Firebase init to always happen. But ONLY if Firebase credentials exist — otherwise the server can't start locally without them. Actually, since we're mandating Firebase auth, we should always init. The `else` branch (local storage) still needs Firebase for auth.

Add Firebase init after the storage setup but before buildServer:

```typescript
  // Initialize Firebase Admin SDK (required for auth)
  if (STORAGE_BACKEND === 'firestore') {
    // Already initialized above
  } else {
    // For local storage backend, still need Firebase Auth
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('[Auth] Firebase Admin SDK initialized (local storage mode)');
  }
```

Wait — actually the current code already inits Firebase in the `firestore` block. Since prod always uses firestore, and we're not changing the storage backend logic, this is fine. For local dev with local storage, we'd need Firebase init added. But let's keep it simple: move the `initializeApp` call out of the `if (STORAGE_BACKEND === 'firestore')` block to happen unconditionally.

**Step 4: Build and verify no compile errors**

Run: `pnpm build`
Expected: SUCCESS

**Step 5: Commit**

```
feat: remove legacy token auth, always use Firebase auth
```

---

### Task 2: Strip `?token=` from dashboard templates

**Files:**
- Modify: `src/dashboard/templates.ts:1` (layout function signature)

**Step 1: Remove `token` param from `layout()` function**

Change the function signature from `layout(title: string, content: string, token: string)` to `layout(title: string, content: string)`.

Remove all `?token=${token}` from the nav links in the template (lines 96-101). Nav becomes:
```html
<a href="/dashboard">Home</a>
<a href="/dashboard/captures">Captures</a>
<a href="/dashboard/routes">Routes</a>
<a href="/dashboard/reviews">Reviews</a>
<a href="/dashboard/auth">Auth Status</a>
<a href="/dashboard/test-suite">Test Suite</a>
```

**Step 2: Build to find all call sites that need updating**

Run: `pnpm build`
Expected: FAIL — TypeScript errors at every `layout(title, content, token)` call in `dashboard/routes.ts`

**Step 3: Fix all `layout()` call sites in `dashboard/routes.ts`**

For every route handler in `src/dashboard/routes.ts`:
1. Remove `const token = c.req.query('token') || '';`
2. Change `layout(title, content, token)` to `layout(title, content)`
3. Remove `?token=${token}` from every `href`, `action`, and `redirect()` URL

This is a bulk change across ~90 occurrences. Key patterns to find-and-replace:
- `?token=${token}` → remove entirely
- `layout('...', content, token)` → `layout('...', content)`
- `c.req.query('token') || ''` → remove the line

Also in the hidden form fields like `<input type="hidden" name="token" value="${token}">` — remove them.

**Step 4: Build and verify**

Run: `pnpm build`
Expected: SUCCESS

**Step 5: Commit**

```
refactor: strip ?token= from dashboard, use session cookie auth
```

---

### Task 3: Fix OAuth routes to use authenticated user

**Files:**
- Modify: `src/server/oauth.ts:90-95` (connect/intend)
- Modify: `src/server/oauth.ts:183-189` (auth/status/intend)
- Modify: `src/server/oauth.ts:204-209` (disconnect/intend)
- Modify: `src/dashboard/routes.ts:424` (dashboard auth page)

**Step 1: Update `/connect/intend` to use session auth**

Currently reads `c.req.query('user')`. Change to read from auth context:

```typescript
app.get('/connect/intend', async (c) => {
  const auth = c.get('auth');
  if (!auth?.uid) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const user = auth.uid;
  // ... rest unchanged ...
```

Note: `/connect/intend` is currently in the public paths list for legacy mode. It should NOT be public — it needs auth. Remove it from publicPaths if it's there (check `server/index.ts`). Actually, looking at the code, it's not in publicPaths — the legacy mode skipped auth for `/connect/` and `/oauth/` paths explicitly. Since we removed the legacy branch, these now go through Firebase auth middleware, which is correct. But `/oauth/callback/intend` needs to stay accessible without auth (it's the callback from intend.do). Add it to publicPaths.

Update publicPaths in `src/server/index.ts`:
```typescript
publicPaths: ['/', '/login', '/secret-signup', '/widget', '/api/session', '/oauth/callback', '/oauth/success', '/oauth/error'],
```

**Step 2: Update `/auth/status/intend`**

```typescript
app.get('/auth/status/intend', async (c) => {
  const auth = c.get('auth');
  if (!auth?.uid) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const user = auth.uid;
  // ... rest unchanged, remove the manual user check ...
```

**Step 3: Update `/disconnect/intend`**

```typescript
app.post('/disconnect/intend', async (c) => {
  const auth = c.get('auth');
  if (!auth?.uid) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const user = auth.uid;
  // ... rest unchanged ...
```

Also update the disconnect route to support redirect. Currently the dashboard auth page POSTs to `/disconnect/intend?token=...&redirect=/dashboard/auth`. After removing token, the redirect param should still work. Add redirect support:

```typescript
  await storage.clearIntendTokens(user);
  const redirect = c.req.query('redirect');
  if (redirect) {
    return c.redirect(redirect);
  }
  return c.json({ success: true });
```

**Step 4: Update dashboard auth page to use session user**

In `src/dashboard/routes.ts`, the `/dashboard/auth` route (around line 424):

Change `const integrations = await getIntegrationsWithStatus(storage, 'default');` to:
```typescript
const auth = c.get('auth');
const integrations = await getIntegrationsWithStatus(storage, auth.uid);
```

Also update the connect/disconnect links in the auth page HTML to not pass `?user=` or `?token=`:
- `<a href="/connect/${i.id}?token=${token}">Connect</a>` → `<a href="/connect/${i.id}">Connect</a>`
- `<form method="post" action="/disconnect/${i.id}?token=${token}&redirect=/dashboard/auth">` → `<form method="post" action="/disconnect/${i.id}?redirect=/dashboard/auth">`

**Step 5: Update OAuth callback to redirect to dashboard auth page**

In `src/server/oauth.ts`, on success (line 176), redirect to dashboard instead of the standalone success page:
```typescript
return c.redirect('/dashboard/auth');
```

**Step 6: Build and verify**

Run: `pnpm build`
Expected: SUCCESS

**Step 7: Commit**

```
fix: OAuth routes use authenticated user from session, not query param
```

---

### Task 4: Clean up widget token fallback

**Files:**
- Modify: `src/widget/index.html:150-206`

**Step 1: Simplify widget auth**

The widget currently has dual-mode auth (token fallback vs Firebase). Since we're removing token auth, simplify:

Remove `API_TOKEN` and `useFirebaseAuth` variables. Always use Firebase auth. Remove `getAuthQuery()` function. The widget already has Firebase auth logic — just remove the token fallback path.

Lines to change:
```javascript
// Remove these:
const API_TOKEN = urlParams.get('token');
const useFirebaseAuth = !API_TOKEN && typeof firebase !== 'undefined';

// Replace with:
const useFirebaseAuth = true;
```

And in `getAuthHeaders()`, remove the non-Firebase branch. And remove `getAuthQuery()` entirely — replace `${getAuthQuery()}` with empty string in fetch URLs.

**Step 2: Build and verify**

Run: `pnpm build`
Expected: SUCCESS (widget is HTML, not compiled, but verify server still serves it)

**Step 3: Commit**

```
refactor: widget always uses Firebase auth, remove token fallback
```

---

### Task 5: Create test user and write E2E auth helper

**Files:**
- Create: `tests/e2e/helpers/auth.ts`
- Modify: `playwright.config.ts`

**Step 1: Create auth helper for E2E tests**

The E2E tests need to authenticate as `qtess@slapture.com`. Since we can't use Firebase client SDK in Playwright directly, the tests should:
1. Use the Playwright browser to login via `/login` page (email/password form)
2. This sets the `__session` cookie
3. Subsequent API calls from `request` context share the cookie

Create `tests/e2e/helpers/auth.ts`:
```typescript
import { Page } from '@playwright/test';

export const TEST_USER_EMAIL = 'qtess@slapture.com';
export const TEST_USER_PASSWORD = 'q';

export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(TEST_USER_EMAIL);
  await page.locator('#password').fill(TEST_USER_PASSWORD);
  await page.locator('#submit-btn').click();
  // Wait for redirect to /widget (successful login)
  await page.waitForURL('**/widget', { timeout: 10000 });
}
```

**Step 2: Update playwright config for prod testing**

The tests will run against the deployed Cloud Run instance. Update `playwright.config.ts` to support a `BASE_URL` env var:

```typescript
import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.TEST_PORT || '4445'}`;

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: BASE_URL,
  },
  // Only start local server if not using external BASE_URL
  ...(process.env.BASE_URL ? {} : {
    webServer: {
      command: 'pnpm start',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
        PORT: process.env.TEST_PORT || '4445',
      },
    },
  }),
});
```

**Step 3: Commit**

```
feat: add E2E auth helper and configurable base URL for playwright
```

---

### Task 6: Create the test user in prod Firebase

**Files:**
- Create: `tmp/create-test-user.ts` (temporary script, gitignored)

**Step 1: Write a script to create the test user**

Create `tmp/create-test-user.ts`:
```typescript
import 'dotenv/config';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FirestoreStorage } from '../src/storage/firestore.js';

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

async function main() {
  const auth = getAuth();
  const storage = new FirestoreStorage();

  const email = 'qtess@slapture.com';
  const password = 'q';

  try {
    // Try to get existing user
    const existing = await auth.getUserByEmail(email).catch(() => null);
    if (existing) {
      console.log(`User already exists: ${existing.uid}`);
      // Ensure user profile exists in Firestore
      const profile = await storage.getUser(existing.uid);
      if (!profile) {
        await storage.saveUser({
          uid: existing.uid,
          email,
          displayName: 'qtess',
          createdAt: new Date().toISOString(),
          authProvider: 'email',
        });
        console.log('Created user profile in Firestore');
      }
      return;
    }

    // Create new user
    const user = await auth.createUser({
      email,
      password,
      displayName: 'qtess',
    });
    console.log(`Created Firebase Auth user: ${user.uid}`);

    // Create Firestore profile
    await storage.saveUser({
      uid: user.uid,
      email,
      displayName: 'qtess',
      createdAt: new Date().toISOString(),
      authProvider: 'email',
    });
    console.log('Created user profile in Firestore');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
```

**Step 2: Run the script**

Run: `pnpm tsx tmp/create-test-user.ts`
Expected: User created or already exists message

**Step 3: Verify by signing in via the login page**

Open browser, go to prod URL, login with qtess@slapture.com / q. Should succeed and redirect to widget.

**Step 4: Don't commit** (temp script, cleanup later)

---

### Task 7: Write E2E test for Intend OAuth flow

**Files:**
- Modify: `tests/e2e/intend-oauth.spec.ts` (rewrite)

**Step 1: Rewrite the Intend OAuth E2E test**

Replace the existing test with one that uses Firebase auth:

```typescript
import { test, expect } from '@playwright/test';
import { loginAsTestUser, TEST_USER_EMAIL } from './helpers/auth.js';

const TEST_INTEND_USERNAME = 'qtess';
const TEST_INTEND_PASSWORD = 'q';

test.describe('intend.do OAuth Integration', () => {

  test.beforeEach(async ({ page }) => {
    // Login to slapture first
    await loginAsTestUser(page);
  });

  test('complete OAuth flow and route intention capture', async ({ page }) => {
    // 1. Go to dashboard auth page
    await page.goto('/dashboard/auth');
    await expect(page.locator('h1')).toContainText('Auth Status');

    // 2. Click Connect for intend
    await page.click('a[href="/connect/intend"]');

    // 3. Should redirect to intend.do OAuth
    await expect(page).toHaveURL(/intend\.do/, { timeout: 10000 });

    // 4. Login to intend.do
    await page.getByRole('textbox', { name: /username/i }).fill(TEST_INTEND_USERNAME);
    await page.getByRole('textbox', { name: /password/i }).fill(TEST_INTEND_PASSWORD);
    await page.getByRole('button', { name: /log in/i }).click();

    // 5. Authorize (may auto-approve if previously authorized)
    const allowButton = page.getByRole('button', { name: /allow/i });
    if (await allowButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await allowButton.click();
    }

    // 6. Should redirect back to dashboard auth page
    await expect(page).toHaveURL(/\/dashboard\/auth/, { timeout: 15000 });

    // 7. Intend should show as connected
    await expect(page.locator('.badge-success').filter({ hasText: 'connected' })).toBeVisible();

    // 8. Send an intention-formatted capture via API
    const response = await page.request.post('/capture', {
      headers: { 'Cookie': await page.context().cookies().then(c => c.map(ck => `${ck.name}=${ck.value}`).join('; ')) },
      data: { text: '1) test intention from playwright e2e' },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.status).toBe('success');
  });

  test('intention with goal number routes to intend', async ({ page }) => {
    // Assumes OAuth is already connected from previous test or setup
    // Send various intention formats

    const intentions = [
      '1) practice guitar for 30 minutes',
      '+5) completed morning run',
    ];

    for (const text of intentions) {
      const response = await page.request.post('/capture', {
        data: { text },
      });
      const result = await response.json();
      // Should route to intend (may succeed or fail based on route existence)
      // At minimum it should not 401
      expect(response.ok()).toBeTruthy();
    }
  });
});
```

Note: The cookie forwarding approach may not work directly since Playwright's `page.request` shares the page's cookies automatically. Simplify to just `page.request.post('/capture', { data: { text } })`.

**Step 2: Run the test**

Run: `BASE_URL=https://slapture-....run.app pnpm test:e2e tests/e2e/intend-oauth.spec.ts`
Expected: Tests interact with real intend.do OAuth and real captures

**Step 3: Iterate on failures**

The test will likely surface issues:
- Intend login form selectors may differ from what's hardcoded
- The OAuth consent screen may auto-approve on repeat
- Route matching for intention format (`1) ...`) may not have a trigger yet — a route needs to exist
- Cookie handling between page and request contexts

Fix issues as they surface. Use `await page.pause()` or `await page.screenshot({ path: 'debug.png' })` for debugging.

**Step 4: Commit when passing**

```
test: E2E test for Intend OAuth flow with Firebase auth
```

---

### Task 8: Update existing E2E tests for Firebase auth

**Files:**
- Modify: `tests/e2e/capture.spec.ts`
- Modify: `tests/e2e/dashboard.spec.ts`
- Modify: `tests/e2e/auth.spec.ts`

**Step 1: Update capture.spec.ts**

Replace `?token=${TOKEN}` with proper auth. Since these tests use `request` (not `page`), they need an API key or session cookie. The simplest approach: use `page` to login first, then use `page.request` which inherits cookies.

Alternatively, create an API key for the test user and use `X-API-Key` header. This is better for API-only tests.

For now, update tests to login first:
```typescript
import { loginAsTestUser } from './helpers/auth.js';

test.describe('Basic routing', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('dump: prefix routes to dump.txt', async ({ page }) => {
    const response = await page.request.post('/capture', {
      data: { text: 'dump: this is a test' },
    });
    // ...
  });
});
```

Note: The filestore tests read local filesystem (`./filestore/default`). This only works when running against a local server with local storage. When running against prod (Firestore), these filesystem checks won't work. These tests may need to be split into "local-only" vs "prod-compatible" groups. For now, skip the filesystem-dependent tests when `BASE_URL` is set.

**Step 2: Update dashboard.spec.ts**

Replace `?token=${TOKEN}` with login:
```typescript
import { loginAsTestUser } from './helpers/auth.js';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('dashboard home loads', async ({ page }) => {
    await page.goto('/dashboard');
    // ... rest unchanged minus token refs
  });
});
```

**Step 3: Update auth.spec.ts**

The existing tests are mostly fine — they test unauthenticated behavior. Remove the skipped API key test or implement it.

**Step 4: Run all E2E tests**

Run: `pnpm test:e2e`
Expected: All tests pass (may need local server with Firebase auth)

**Step 5: Commit**

```
test: update E2E tests for Firebase auth, remove token-based auth
```

---

### Task 9: Run full test suite and verify

**Step 1: Run unit tests**

Run: `pnpm test`
Expected: All pass (unit tests may mock storage and not depend on auth mode)

**Step 2: Run E2E tests against prod**

Run: `BASE_URL=<prod-url> pnpm test:e2e`
Expected: Auth, dashboard, and intend-oauth tests pass

**Step 3: Manual smoke test**

1. Open prod URL in browser
2. Login as qtess@slapture.com
3. Navigate dashboard — all links work without `?token=`
4. Go to Auth Status — shows integration status for your user
5. If Intend not connected, click Connect and complete OAuth
6. Send a capture via widget: "1) test intention"
7. Verify it routes to Intend and succeeds

**Step 4: Commit any fixes**

---

### Task 10: Deploy and final verification

**Step 1: Deploy to Cloud Run**

Run: `gcloud run deploy slapture --source . --region us-east1`

**Step 2: Run E2E against deployed version**

Run: `BASE_URL=<new-prod-url> pnpm test:e2e tests/e2e/intend-oauth.spec.ts`

**Step 3: Commit plan doc**

```
docs: add firebase auth migration plan
```
