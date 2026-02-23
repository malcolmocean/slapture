import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth.js';

const TEST_INTEND_USERNAME = 'qtess';
const TEST_INTEND_PASSWORD = 'q';

test.describe('intend.do OAuth Integration', () => {

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('complete OAuth flow and route intention capture', async ({ page }) => {
    // 1. Go to dashboard auth page
    await page.goto('/dashboard/auth');
    await expect(page.locator('h1')).toContainText('Auth Status');

    // 2. Click Connect for intend
    await page.click('a[href="/connect/intend"]');

    // 3. Should redirect to intend.do OAuth
    await expect(page).toHaveURL(/intend\.do/, { timeout: 10000 });

    // 4. Login to intend.do (may already be logged in)
    const usernameField = page.getByRole('textbox', { name: /username/i });
    if (await usernameField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await usernameField.fill(TEST_INTEND_USERNAME);
      await page.getByRole('textbox', { name: /password/i }).fill(TEST_INTEND_PASSWORD);
      await page.getByRole('button', { name: /log in/i }).click();
    }

    // 5. Authorize (may auto-approve if previously authorized)
    const allowButton = page.getByRole('button', { name: /allow/i });
    if (await allowButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await allowButton.click();
    }

    // 6. Should redirect back to dashboard auth page
    await expect(page).toHaveURL(/\/dashboard\/auth/, { timeout: 15000 });

    // 7. Intend should show as connected
    await expect(page.locator('.badge-success').filter({ hasText: 'connected' })).toBeVisible();

    // 8. Send an intention-formatted capture via API
    const response = await page.request.post('/capture', {
      data: { text: '1) test intention from playwright e2e' },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.status).toBe('success');
  });

  test('intention with goal number routes to intend', async ({ page }) => {
    const intentions = [
      '1) practice guitar for 30 minutes',
      '+5) completed morning run',
    ];

    for (const text of intentions) {
      const response = await page.request.post('/capture', {
        data: { text },
      });
      expect(response.ok()).toBeTruthy();
    }
  });
});
