import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

const ROAM_TEST_GRAPH_NAME = process.env.ROAM_TEST_GRAPH_NAME || '';
const ROAM_TEST_GRAPH_TOKEN = process.env.ROAM_TEST_GRAPH_TOKEN || '';

test.describe('Roam Integration', () => {
  test.skip(!ROAM_TEST_GRAPH_NAME || !ROAM_TEST_GRAPH_TOKEN,
    'Requires ROAM_TEST_GRAPH_NAME and ROAM_TEST_GRAPH_TOKEN env vars');

  // Roam API calls can be slow
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('can connect a Roam graph, see it listed, and disconnect it', async ({ page }) => {
    // Navigate to auth page and click Settings for Roam
    await page.goto('/dashboard/auth');
    await page.locator('a[href="/dashboard/roam"]').click();
    await page.waitForURL('**/dashboard/roam**');

    // Should see the Roam settings page
    await expect(page.locator('text=Roam Research Settings')).toBeVisible();

    // Fill the "Add Graph" form
    await page.locator('input[name="graphName"]').fill(ROAM_TEST_GRAPH_NAME);
    await page.locator('input[name="token"]').fill(ROAM_TEST_GRAPH_TOKEN);

    // Click connect — button should show "Connecting..."
    const connectBtn = page.locator('#roam-connect-btn');
    await connectBtn.click();

    // Should redirect back to /dashboard/roam after connecting
    await page.waitForURL('**/dashboard/roam**', { timeout: 30_000 });

    // The graph name should now appear in the connected list
    await expect(page.locator(`text=${ROAM_TEST_GRAPH_NAME}`)).toBeVisible();

    // The "Remove" button should be visible for this graph
    const removeButton = page.locator(`form[action*="/disconnect/roam/"] button`);
    await expect(removeButton).toBeVisible();

    // Disconnect the graph
    await removeButton.click();

    // Should redirect back to roam settings
    await page.waitForURL('**/dashboard/roam**', { timeout: 10_000 });

    // The graph should no longer appear
    await expect(page.locator('text=No graphs connected yet')).toBeVisible({ timeout: 5_000 });
  });
});
