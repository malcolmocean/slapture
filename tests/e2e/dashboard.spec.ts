import { test, expect } from '@playwright/test';

const TOKEN = 'dev-token';

test.describe('Dashboard', () => {
  test('dashboard home loads and shows navigation', async ({ page }) => {
    await page.goto(`/dashboard?token=${TOKEN}`);

    expect(await page.title()).toContain('Slapture');
    await expect(page.locator('nav')).toBeVisible();
    // Check nav links specifically
    await expect(page.locator('nav').getByRole('link', { name: /captures/i })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: /routes/i })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: /auth/i })).toBeVisible();
  });

  test('dashboard requires auth token', async ({ page }) => {
    const response = await page.goto('/dashboard');
    expect(response?.status()).toBe(401);
  });
});

test.describe('Capture List', () => {
  test('shows capture list with filters', async ({ page }) => {
    await page.goto(`/dashboard/captures?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Captures');
    await expect(page.locator('select[name="status"]')).toBeVisible();
    await expect(page.locator('input[name="search"]')).toBeVisible();
  });

  test('filters by status', async ({ page }) => {
    await page.goto(`/dashboard/captures?token=${TOKEN}&status=success`);

    // Should show filter applied
    const select = page.locator('select[name="status"]');
    await expect(select).toHaveValue('success');
  });
});

test.describe('Capture Detail', () => {
  test('shows capture detail with execution trace', async ({ page, request }) => {
    // First create a capture
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: test detail view' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Capture Detail');
    await expect(page.locator('text=dump: test detail view')).toBeVisible();
    await expect(page.locator('text=Execution Trace')).toBeVisible();
  });

  test('can verify a capture as correct', async ({ page, request }) => {
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: verify me' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}?token=${TOKEN}`);
    await page.click('button:has-text("Verify Correct")');

    // Wait for page to reload after redirect
    await page.waitForURL(`**/dashboard/captures/${captureId}**`);

    // Should show verified badge (both in status table and "Already Verified" in actions)
    await expect(page.locator('.badge-success').first()).toBeVisible();
  });
});

test.describe('Route Management', () => {
  test('shows route list with stats', async ({ page }) => {
    await page.goto(`/dashboard/routes?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Routes');
    await expect(page.locator('table')).toBeVisible();
    // Should show at least the dump route
    await expect(page.locator('text=dump')).toBeVisible();
  });

  test('shows route detail with triggers', async ({ page }) => {
    // Get the dump route ID
    const routes = await page.request.get(`/routes?token=${TOKEN}`);
    const routeList = await routes.json();
    const dumpRoute = routeList.find((r: { name: string }) => r.name === 'dump');

    await page.goto(`/dashboard/routes/${dumpRoute.id}?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('dump');
    await expect(page.getByRole('heading', { name: 'Triggers' })).toBeVisible();
  });
});

test.describe('Auth Status', () => {
  test('shows integration status list', async ({ page }) => {
    await page.goto(`/dashboard/auth?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Auth Status');
    // Should show integrations
    await expect(page.locator('text=intend.do')).toBeVisible();
    await expect(page.locator('text=Local Files')).toBeVisible();
  });

  test('shows blocked captures count', async ({ page }) => {
    await page.goto(`/dashboard/auth?token=${TOKEN}`);

    // Should show blocked captures section
    await expect(page.getByRole('heading', { name: 'Blocked Captures' })).toBeVisible();
  });
});

test.describe('Correction Flow', () => {
  test('can mark capture as wrong and select correct route', async ({ page, request }) => {
    // Create a capture
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: correction test' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}?token=${TOKEN}`);

    // Click "This was wrong"
    await page.click('a:has-text("This was wrong")');

    // Should show correction form
    await expect(page.locator('text=Select correct route')).toBeVisible();
  });
});

test.describe('Test Suite View', () => {
  test('shows verified captures as golden tests', async ({ page, request }) => {
    // Create and verify a capture
    const res = await request.post(`/capture?token=${TOKEN}`, {
      data: { text: 'dump: test suite item' },
    });
    const { captureId } = await res.json();

    // Verify it
    await request.post(`/dashboard/captures/${captureId}/verify?token=${TOKEN}`);

    // Check test suite
    await page.goto(`/dashboard/test-suite?token=${TOKEN}`);

    await expect(page.locator('h1')).toContainText('Test Suite');
    await expect(page.getByRole('cell', { name: 'dump: test suite item' }).first()).toBeVisible();
  });
});
