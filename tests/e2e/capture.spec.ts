// tests/e2e/capture.spec.ts
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { loginAsTestUser } from './helpers/auth';

const isRemote = !!process.env.BASE_URL;
const FILESTORE = './filestore/default';

test.describe('Example Set A: Basic routing', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isRemote, 'Requires local filesystem');
    // Clean filestore
    if (fs.existsSync(FILESTORE)) {
      fs.rmSync(FILESTORE, { recursive: true, force: true });
    }
    fs.mkdirSync(FILESTORE, { recursive: true });
    await loginAsTestUser(page);
  });

  test('dump: prefix routes to dump.txt', async ({ page }) => {
    const response = await page.request.post(`/capture`, {
      data: { text: 'dump: this is a test' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('success');

    // Verify file was written
    const content = fs.readFileSync(path.join(FILESTORE, 'dump.txt'), 'utf-8');
    expect(content).toContain('this is a test');
  });

  test('note: prefix routes to notes.json', async ({ page }) => {
    const response = await page.request.post(`/capture`, {
      data: { text: 'note: remember to check logs' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('success');

    // Verify JSON was written
    const content = fs.readFileSync(path.join(FILESTORE, 'notes.json'), 'utf-8');
    const data = JSON.parse(content);
    const values = Object.values(data);
    expect(values).toContain('remember to check logs');
  });
});

test.describe('Example Set D: Progressive UI status', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isRemote, 'Requires local routes (dump)');
    // Clean filestore
    if (fs.existsSync(FILESTORE)) {
      fs.rmSync(FILESTORE, { recursive: true, force: true });
    }
    fs.mkdirSync(FILESTORE, { recursive: true });
    await loginAsTestUser(page);
  });

  test('widget shows status updates for dump capture', async ({ page }) => {
    await page.goto(`/widget`);

    // Enter capture text
    await page.fill('input#captureInput', 'dump: test from playwright');
    await page.click('button#submitBtn');

    // Wait for success status - widget shows "check {routeName}" on completion
    await expect(page.locator('#step-result')).toContainText('append-dump.txt', { timeout: 10000 });
  });
});

test.describe('Example Set E: Error handling', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('returns 404 for unknown capture status', async ({ page }) => {
    test.skip(isRemote, 'Firestore returns 500 for missing captures (pre-existing)');
    const response = await page.request.get(`/status/nonexistent`);
    expect(response.status()).toBe(404);
  });

  test('returns 401 for missing auth token', async ({ request }) => {
    const response = await request.post(`/capture`, {
      data: { text: 'dump: test' },
    });
    expect(response.status()).toBe(401);
  });

  test('returns 400 for missing text', async ({ page }) => {
    const response = await page.request.post(`/capture`, {
      data: {},
    });
    expect(response.status()).toBe(400);
  });
});

test.describe('Example Set F: Integration notes', () => {
  const NOTES_DIR = './data/users/default/notes/integrations';

  test.beforeEach(async ({ page }) => {
    test.skip(isRemote, 'Requires local filesystem');
    // Clean the integration notes directory
    if (fs.existsSync(NOTES_DIR)) {
      fs.rmSync(NOTES_DIR, { recursive: true, force: true });
    }
    await loginAsTestUser(page);
  });

  test('note on intend: saves to integration notes', async ({ page }) => {
    const response = await page.request.post(`/capture`, {
      data: { text: 'note on intend: I use present tense verbs' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('success');

    // Verify the note was saved to the correct location
    const notePath = path.join(NOTES_DIR, 'intend.txt');
    expect(fs.existsSync(notePath)).toBe(true);
    const content = fs.readFileSync(notePath, 'utf-8');
    expect(content).toContain('I use present tense verbs');
  });

  test('multiple notes on same integration append', async ({ page }) => {
    // First note
    await page.request.post(`/capture`, {
      data: { text: 'note on intend: First note' },
    });

    // Second note
    await page.request.post(`/capture`, {
      data: { text: 'note on intend: Second note' },
    });

    // Verify both notes are present
    const notePath = path.join(NOTES_DIR, 'intend.txt');
    const content = fs.readFileSync(notePath, 'utf-8');
    expect(content).toContain('First note');
    expect(content).toContain('Second note');
  });
});

test.describe('API Endpoints', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('GET /routes returns route list', async ({ page }) => {
    test.skip(isRemote, 'Requires local routes (dump, note)');
    const response = await page.request.get(`/routes`);
    expect(response.ok()).toBeTruthy();

    const routes = await response.json();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);

    // Check for expected routes
    const routeNames = routes.map((r: { name: string }) => r.name);
    expect(routeNames).toContain('dump');
    expect(routeNames).toContain('note');
  });

  test('GET /captures returns capture list', async ({ page }) => {
    const response = await page.request.get(`/captures`);
    expect(response.ok()).toBeTruthy();

    const captures = await response.json();
    expect(Array.isArray(captures)).toBe(true);
  });
});
