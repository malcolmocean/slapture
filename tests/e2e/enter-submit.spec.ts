import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test('Enter key submits capture from widget', async ({ page }) => {
  await loginAsTestUser(page);
  await page.goto('/widget');

  await expect(page.locator('#captureInput')).toBeEnabled({ timeout: 10000 });

  await page.locator('#captureInput').fill('dump: enter key test');
  await page.keyboard.press('Enter');

  // Status area should become visible — form submitted
  await expect(page.locator('#status')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#step-parse')).toHaveClass(/active|done/, { timeout: 5000 });
});
