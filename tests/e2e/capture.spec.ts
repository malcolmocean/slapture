// tests/e2e/capture.spec.ts
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const TOKEN = 'dev-token';
const FILESTORE = './filestore/default';

test.describe('Example Set A: Basic routing', () => {
  test.beforeEach(async () => {
    // Clean filestore
    if (fs.existsSync(FILESTORE)) {
      fs.rmSync(FILESTORE, { recursive: true, force: true });
    }
    fs.mkdirSync(FILESTORE, { recursive: true });
  });

  test('dump: prefix routes to dump.txt', async ({ request }) => {
    const response = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: this is a test' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('success');

    // Verify file was written
    const content = fs.readFileSync(path.join(FILESTORE, 'dump.txt'), 'utf-8');
    expect(content).toContain('this is a test');
  });

  test('note: prefix routes to notes.json', async ({ request }) => {
    const response = await request.post(`/capture?token=${TOKEN}`, {
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
  test.beforeEach(async () => {
    // Clean filestore
    if (fs.existsSync(FILESTORE)) {
      fs.rmSync(FILESTORE, { recursive: true, force: true });
    }
    fs.mkdirSync(FILESTORE, { recursive: true });
  });

  test('widget shows status updates for dump capture', async ({ page }) => {
    await page.goto(`/widget?token=${TOKEN}`);

    // Enter capture text
    await page.fill('input#captureInput', 'dump: test from playwright');
    await page.click('button#submitBtn');

    // Wait for success status - using text content check
    await expect(page.locator('#step-result')).toContainText('Sent to', { timeout: 10000 });
  });
});

test.describe('Example Set E: Error handling', () => {
  test('returns 404 for unknown capture status', async ({ request }) => {
    const response = await request.get(`/status/nonexistent?token=${TOKEN}`);
    expect(response.status()).toBe(404);
  });

  test('returns 401 for missing auth token', async ({ request }) => {
    const response = await request.post(`/capture`, {
      data: { text: 'dump: test' },
    });
    expect(response.status()).toBe(401);
  });

  test('returns 400 for missing text', async ({ request }) => {
    const response = await request.post(`/capture?token=${TOKEN}`, {
      data: {},
    });
    expect(response.status()).toBe(400);
  });
});

test.describe('API Endpoints', () => {
  test('GET /routes returns route list', async ({ request }) => {
    const response = await request.get(`/routes?token=${TOKEN}`);
    expect(response.ok()).toBeTruthy();

    const routes = await response.json();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);

    // Check for expected routes
    const routeNames = routes.map((r: { name: string }) => r.name);
    expect(routeNames).toContain('dump');
    expect(routeNames).toContain('note');
  });

  test('GET /captures returns capture list', async ({ request }) => {
    const response = await request.get(`/captures?token=${TOKEN}`);
    expect(response.ok()).toBeTruthy();

    const captures = await response.json();
    expect(Array.isArray(captures)).toBe(true);
  });
});
