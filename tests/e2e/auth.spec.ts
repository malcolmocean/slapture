import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('landing page loads without auth', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('slapture');
    await expect(page.locator('a[href="/login"]')).toBeVisible();
  });

  test('login page loads with sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#google-btn')).toBeVisible();
    await expect(page.locator('#email-form')).toBeVisible();
    await expect(page.locator('#submit-btn')).toHaveText('Sign in');
  });

  test('signup page defaults to create account mode', async ({ page }) => {
    await page.goto('/secret-signup');
    await expect(page.locator('#submit-btn')).toHaveText('Create account');
  });

  test('protected routes redirect/return 401 without auth', async ({ request }) => {
    const res = await request.get('/captures');
    expect(res.status()).toBe(401);
  });

  test('API key auth works for capture endpoint', async ({ request }) => {
    // This test requires a pre-created API key
    // In CI, use Firebase emulator + programmatic user creation
    test.skip(true, 'Requires Firebase emulator setup');
  });
});
