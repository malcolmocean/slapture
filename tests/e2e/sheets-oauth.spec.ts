import { test, expect, Page } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth.js';

const GOOGLE_TEST_ACCOUNT = process.env.GOOGLE_TEST_ACCOUNT || '';
const GOOGLE_TEST_ACCOUNT_PASSWORD = process.env.GOOGLE_TEST_ACCOUNT_PASSWORD || '';

/**
 * Helper: click a button by text on Google's consent pages.
 * Uses multiple selector strategies since Google's DOM varies.
 * Returns true if a button was found and clicked.
 */
async function clickGoogleButton(page: Page, text: string, timeout = 5000): Promise<boolean> {
  // Try multiple selector strategies
  const selectors = [
    `button:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
  ];

  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout }).catch(() => false)) {
      await el.click();
      return true;
    }
  }
  return false;
}

/**
 * Helper: click through Google's OAuth pages after login.
 * Handles: unverified app warning, scope consent, and any "Allow" buttons.
 * Each step is optional (skipped if not visible) so the test survives
 * when Google changes or removes pages (e.g. after app verification).
 */
async function handleGoogleConsentScreens(page: Page): Promise<void> {
  // Google "hasn't verified this app" warning — click Continue
  if (await clickGoogleButton(page, 'Continue')) {
    await page.waitForTimeout(3000);
  }

  // Scope consent page — may have another Continue
  if (await clickGoogleButton(page, 'Continue')) {
    await page.waitForTimeout(3000);
  }

  // Possible "Allow" button (older consent UI)
  if (await clickGoogleButton(page, 'Allow', 3000)) {
    await page.waitForTimeout(2000);
  }
}

test.describe('Google Sheets OAuth Integration', () => {
  test.skip(!GOOGLE_TEST_ACCOUNT || !GOOGLE_TEST_ACCOUNT_PASSWORD,
    'Requires GOOGLE_TEST_ACCOUNT and GOOGLE_TEST_ACCOUNT_PASSWORD env vars');

  // Google OAuth is slow — generous timeouts
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('complete OAuth flow: connect Google Sheets', async ({ page }) => {
    // 1. Go to Sheets settings page
    await page.goto('/dashboard/integrations/sheets');
    await expect(page.locator('h1')).toContainText('Google Sheets Settings');

    // 2. Click Connect for Google Sheets
    await page.click('a[href="/connect/sheets"]');

    // 3. Should redirect to Google OAuth
    await page.waitForURL(/accounts\.google\.com/, { timeout: 15000 });

    // 4. Google sign-in: enter email
    const emailField = page.locator('#identifierId, input[type="email"]');
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.fill(GOOGLE_TEST_ACCOUNT);
    await emailField.press('Enter');

    // 5. Wait for password page
    await page.waitForTimeout(3000);
    const passwordField = page.locator('input[type="password"][name="Passwd"], input[type="password"]');
    await passwordField.waitFor({ state: 'visible', timeout: 15000 });
    await passwordField.fill(GOOGLE_TEST_ACCOUNT_PASSWORD);
    await passwordField.press('Enter');
    await page.waitForTimeout(5000);

    // 6. Click through consent screens (all optional/skippable)
    await handleGoogleConsentScreens(page);

    // 7. Should redirect back to dashboard auth page
    await expect(page).toHaveURL(/\/dashboard\/auth/, { timeout: 30000 });

    // 8. Google Sheets should show as connected
    const sheetsRow = page.locator('tr', { hasText: 'Google Sheets' });
    await expect(sheetsRow.locator('.badge-success')).toContainText('connected');
  });

  test('verify auth status API after connect', async ({ page }) => {
    const response = await page.request.get('/auth/status/sheets');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('connected');
    expect(data).toHaveProperty('blockedCaptureCount');
  });

  test('disconnect Google Sheets', async ({ page }) => {
    await page.goto('/dashboard/auth');
    const sheetsRow = page.locator('tr', { hasText: 'Google Sheets' });
    const disconnectButton = sheetsRow.locator('button:has-text("Disconnect")');

    if (await disconnectButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await disconnectButton.click();
      await page.waitForURL(/\/dashboard\/auth/, { timeout: 10000 });

      // Should no longer be connected
      const statusResponse = await page.request.get('/auth/status/sheets');
      const data = await statusResponse.json();
      expect(data.connected).toBe(false);
    } else {
      test.skip();
    }
  });
});
