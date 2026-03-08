// tests/integrations/intend-sandbox.test.ts
//
// Integration tests using intend.do sandbox users.
// These hit the real API — no mocks. They require network access
// and will be skipped if sandbox creation/auth fails or network is down.
//
// Rate limit: 5 sandbox creations per IP per hour (unauthenticated).
// We minimize sandbox creation by sharing one across test suites.
// Set INTEND_PAT to increase the limit to 30/hour.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const INTEND_BASE_URL = 'https://intend.do';
const INTEND_PAT = process.env.INTEND_PAT;

interface SandboxUser {
  auth_token: string;
  username: string;
  preset: string;
  expiresAt: string;
}

function authedUrl(path: string, authToken: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${INTEND_BASE_URL}${path}${sep}auth_token=${authToken}`;
}

async function createSandboxUser(
  preset: 'blank' | 'goals' | 'goals_intentions' = 'goals_intentions',
): Promise<SandboxUser> {
  const url = INTEND_PAT
    ? `${INTEND_BASE_URL}/api/v0/sandbox_user?auth_token=${INTEND_PAT}`
    : `${INTEND_BASE_URL}/api/v0/sandbox_user`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ preset }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sandbox creation failed (${response.status}): ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function deleteSandboxUser(authToken: string): Promise<void> {
  await fetch(authedUrl(`/api/v0/sandbox_user/${authToken}`, authToken), {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  }).catch(() => {});
}

async function getUserInfo(authToken: string): Promise<{ name: string; username: string }> {
  const response = await fetch(
    authedUrl('/api/v0/u/me/userinfo.json', authToken),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error(`Failed to fetch user info: ${response.status}`);
  return response.json();
}

async function postIntention(authToken: string, raw: string): Promise<unknown> {
  const response = await fetch(
    authedUrl('/api/v0/u/me/intentions', authToken),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ raw }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to add intention (${response.status}): ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function getTodayCore(authToken: string): Promise<unknown> {
  const response = await fetch(
    authedUrl('/api/v0/u/me/today/core.json', authToken),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error(`Failed to fetch today: ${response.status}`);
  return response.json();
}

async function getActiveGoals(authToken: string): Promise<unknown> {
  const response = await fetch(
    authedUrl('/api/v0/u/me/goals/active.json', authToken),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error(`Failed to fetch goals: ${response.status}`);
  return response.json();
}

// Pre-flight: create one sandbox and verify API access works.
// This single sandbox is reused by all tests to stay within rate limits.
let sandbox: SandboxUser | null = null;
let sandboxAvailable = false;
let setupError = '';

try {
  sandbox = await createSandboxUser('goals_intentions');
  const verifyResp = await fetch(
    authedUrl('/api/v0/u/me/userinfo.json', sandbox.auth_token),
    { headers: { Accept: 'application/json' }, redirect: 'manual' },
  );
  if (verifyResp.ok) {
    sandboxAvailable = true;
  } else {
    setupError = `Sandbox created but API calls fail (${verifyResp.status})`;
    await deleteSandboxUser(sandbox.auth_token);
    sandbox = null;
  }
} catch (e: any) {
  if (e.message?.includes('fetch failed') || e.message?.includes('ENOTFOUND')) {
    setupError = 'Network unavailable';
  } else {
    setupError = e.message;
  }
}

const describeIfSandbox = sandboxAvailable ? describe : describe.skip;

// Clean up the shared sandbox after all tests
afterAll(async () => {
  if (sandbox) await deleteSandboxUser(sandbox.auth_token);
}, 10000);

describeIfSandbox('Intend API contract (sandbox)', () => {
  it('sandbox user should have valid credentials', async () => {
    const userInfo = await getUserInfo(sandbox!.auth_token);
    expect(userInfo.username).toBe(sandbox!.username);
  });

  it('goals_intentions preset should have active goals', async () => {
    const goals = await getActiveGoals(sandbox!.auth_token);
    expect(goals).toBeDefined();
    expect(JSON.stringify(goals).length).toBeGreaterThan(2);
  });

  it('should add ungrouped intention (&) and verify it appears', async () => {
    const text = `slapture-ungrouped-${Date.now()}`;
    const result = await postIntention(sandbox!.auth_token, `&) ${text}`);
    expect(result).toBeDefined();

    const today = await getTodayCore(sandbox!.auth_token);
    expect(JSON.stringify(today)).toContain(text);
  });

  it('should add intention with goal number (1)', async () => {
    const text = `slapture-goal1-${Date.now()}`;
    const result = await postIntention(sandbox!.auth_token, `1) ${text}`);
    expect(result).toBeDefined();

    const today = await getTodayCore(sandbox!.auth_token);
    expect(JSON.stringify(today)).toContain(text);
  });

  it('should add intention with multi-goal code (2,3)', async () => {
    const text = `slapture-multigoal-${Date.now()}`;
    const result = await postIntention(sandbox!.auth_token, `2,3) ${text}`);
    expect(result).toBeDefined();

    const today = await getTodayCore(sandbox!.auth_token);
    expect(JSON.stringify(today)).toContain(text);
  });

  it('should return non-empty data on successful add', async () => {
    const result = await postIntention(sandbox!.auth_token, `&) data-check-${Date.now()}`);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });

  it('should handle multiple intentions sequentially', async () => {
    const texts = [
      `multi-a-${Date.now()}`,
      `multi-b-${Date.now()}`,
      `multi-c-${Date.now()}`,
    ];

    for (const text of texts) {
      await postIntention(sandbox!.auth_token, `&) ${text}`);
    }

    const today = await getTodayCore(sandbox!.auth_token);
    const todayStr = JSON.stringify(today);
    for (const text of texts) {
      expect(todayStr).toContain(text);
    }
  });
});

// This doesn't need sandbox — tests error handling against the real API
describe('Intend API error handling (real API)', () => {
  it('should reject invalid auth_token', async () => {
    const response = await fetch(
      authedUrl('/api/v0/u/me/userinfo.json', 'completely-invalid-token'),
      { headers: { Accept: 'application/json' } },
    );
    expect(response.ok).toBe(false);
  });
});

if (!sandboxAvailable) {
  describe('Sandbox tests (SKIPPED)', () => {
    it.skip(`reason: ${setupError}`, () => {});
  });
}
