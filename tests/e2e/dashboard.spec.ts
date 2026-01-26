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
