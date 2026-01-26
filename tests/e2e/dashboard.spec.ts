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
