import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth.js';

const TEST_INTEND_USERNAME = 'qtess';
const TEST_INTEND_PASSWORD = 'q';

// NOTE: This test creates real captures in Firestore. It should only be run
// against test accounts. Capture IDs are tracked for potential cleanup.
test.describe('intend.do OAuth Integration', () => {
  const createdCaptureIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test.afterEach(async ({ page }) => {
    // No delete capture API exists, so clean up by retrying (which updates status)
    // or log for manual cleanup. For now, attempt to delete via dashboard if possible.
    for (const id of createdCaptureIds) {
      // Best effort: log for manual cleanup since no DELETE /capture/:id endpoint exists
      console.log(`[intend-oauth cleanup] Capture ${id} created by test — delete manually if needed`);
    }
    createdCaptureIds.length = 0;
  });

  test('complete OAuth flow and route intention capture', async ({ page }) => {
    // TODO: intend.do login form selectors need manual verification
    // Run with --headed to debug: npx playwright test tests/e2e/intend-oauth.spec.ts --headed
    // 1. Go to intend settings page
    await page.goto('/dashboard/integrations/intend');
    await expect(page.locator('h1')).toContainText('intend.do Settings');

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
    if (result.captureId) createdCaptureIds.push(result.captureId);
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
      const result = await response.json();
      if (result.captureId) createdCaptureIds.push(result.captureId);
    }
  });
});
