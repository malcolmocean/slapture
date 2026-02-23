import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

const isRemote = !!process.env.BASE_URL;

test.describe('Dashboard', () => {
  test('dashboard home loads and shows navigation', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto(`/dashboard`);

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
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('shows capture list with filters', async ({ page }) => {
    await page.goto(`/dashboard/captures`);

    await expect(page.locator('h1')).toContainText('Captures');
    await expect(page.locator('select[name="status"]')).toBeVisible();
    await expect(page.locator('input[name="search"]')).toBeVisible();
  });

  test('filters by status', async ({ page }) => {
    await page.goto(`/dashboard/captures?status=success`);

    // Should show filter applied
    const select = page.locator('select[name="status"]');
    await expect(select).toHaveValue('success');
  });
});

test.describe('Capture Detail', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isRemote, 'Requires local routes (dump)');
    await loginAsTestUser(page);
  });

  test('shows capture detail with execution trace', async ({ page }) => {
    // First create a capture
    const res = await page.request.post(`/capture`, {
      data: { text: 'dump: test detail view' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}`);

    await expect(page.locator('h1')).toContainText('Capture Detail');
    await expect(page.locator('text=dump: test detail view')).toBeVisible();
    await expect(page.locator('text=Execution Trace')).toBeVisible();
  });

  test('can verify a capture as correct', async ({ page }) => {
    const res = await page.request.post(`/capture`, {
      data: { text: 'dump: verify me' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}`);
    await page.click('button:has-text("Verify Correct")');

    // Wait for page to reload after redirect
    await page.waitForURL(`**/dashboard/captures/${captureId}**`);

    // Should show verified badge (both in status table and "Already Verified" in actions)
    await expect(page.locator('.badge-success').first()).toBeVisible();
  });
});

test.describe('Route Management', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isRemote, 'Requires local routes (dump)');
    await loginAsTestUser(page);
  });

  test('shows route list with stats', async ({ page }) => {
    await page.goto(`/dashboard/routes`);

    await expect(page.locator('h1')).toContainText('Routes');
    await expect(page.locator('table')).toBeVisible();
    // Should show at least the dump route
    await expect(page.locator('text=dump')).toBeVisible();
  });

  test('shows route detail with triggers', async ({ page }) => {
    // Get the dump route ID
    const routes = await page.request.get(`/routes`);
    const routeList = await routes.json();
    const dumpRoute = routeList.find((r: { name: string }) => r.name === 'dump');

    await page.goto(`/dashboard/routes/${dumpRoute.id}`);

    await expect(page.locator('h1')).toContainText('dump');
    await expect(page.getByRole('heading', { name: 'Triggers' })).toBeVisible();
  });
});

test.describe('Auth Status', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('shows integration status list', async ({ page }) => {
    await page.goto(`/dashboard/auth`);

    await expect(page.locator('h1')).toContainText('Auth Status');
    // Should show integrations
    await expect(page.locator('text=intend.do')).toBeVisible();
    await expect(page.locator('text=Local Files')).toBeVisible();
  });

  test('shows blocked captures count', async ({ page }) => {
    await page.goto(`/dashboard/auth`);

    // Should show blocked captures section
    await expect(page.getByRole('heading', { name: 'Blocked Captures' })).toBeVisible();
  });
});

test.describe('Correction Flow', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isRemote, 'Requires local routes (dump)');
    await loginAsTestUser(page);
  });

  test('can mark capture as wrong and select correct route', async ({ page }) => {
    // Create a capture
    const res = await page.request.post(`/capture`, {
      data: { text: 'dump: correction test' },
    });
    const { captureId } = await res.json();

    await page.goto(`/dashboard/captures/${captureId}`);

    // Click "This was wrong"
    await page.click('a:has-text("This was wrong")');

    // Should show correction form
    await expect(page.locator('text=Select correct route')).toBeVisible();
  });
});

test.describe('Test Suite View', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isRemote, 'Requires local routes (dump)');
    await loginAsTestUser(page);
  });

  test('shows verified captures as golden tests', async ({ page }) => {
    // Create and verify a capture
    const res = await page.request.post(`/capture`, {
      data: { text: 'dump: test suite item' },
    });
    const { captureId } = await res.json();

    // Verify it
    await page.request.post(`/dashboard/captures/${captureId}/verify`);

    // Check test suite
    await page.goto(`/dashboard/test-suite`);

    await expect(page.locator('h1')).toContainText('Test Suite');
    await expect(page.getByRole('cell', { name: 'dump: test suite item' }).first()).toBeVisible();
  });
});
