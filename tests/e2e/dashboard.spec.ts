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
