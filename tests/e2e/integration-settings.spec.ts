import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('Integration Settings Pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('auth page links all integrations to settings pages', async ({ page }) => {
    await page.goto('/dashboard/auth');

    // Every integration name should be a link to its settings page
    await expect(page.locator('a:has-text("intend.do")')).toHaveAttribute('href', '/dashboard/integrations/intend');
    await expect(page.locator('a:has-text("Local Files")')).toHaveAttribute('href', '/dashboard/integrations/fs');
    await expect(page.locator('a:has-text("Google Sheets")')).toHaveAttribute('href', '/dashboard/integrations/sheets');
    await expect(page.locator('a:has-text("Roam Research")')).toHaveAttribute('href', '/dashboard/roam');
  });

  test('generic integration settings page loads for intend', async ({ page }) => {
    await page.goto('/dashboard/integrations/intend');

    await expect(page.locator('h1')).toContainText('intend.do Settings');
    await expect(page.locator('text=Track daily intentions')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await expect(page.locator('textarea[name="notes"]')).toBeVisible();
  });

  test('generic integration settings page loads for sheets', async ({ page }) => {
    await page.goto('/dashboard/integrations/sheets');

    await expect(page.locator('h1')).toContainText('Google Sheets Settings');
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  });

  test('generic integration settings page loads for fs', async ({ page }) => {
    await page.goto('/dashboard/integrations/fs');

    await expect(page.locator('h1')).toContainText('Local Files Settings');
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  });

  test('generic integration settings page loads for notes', async ({ page }) => {
    await page.goto('/dashboard/integrations/notes');

    await expect(page.locator('h1')).toContainText('Notes Settings');
    await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();
  });

  test('roam redirects to dedicated settings page', async ({ page }) => {
    await page.goto('/dashboard/integrations/roam');

    await page.waitForURL('**/dashboard/roam');
    await expect(page.locator('h1')).toContainText('Roam Research Settings');
  });

  test('roam settings page shows notes section', async ({ page }) => {
    await page.goto('/dashboard/roam');

    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await expect(page.locator('textarea[name="notes"]')).toBeVisible();
  });

  test('can save and retrieve integration notes', async ({ page }) => {
    await page.goto('/dashboard/integrations/intend');

    const testNote = `Test note ${Date.now()}`;
    await page.locator('textarea[name="notes"]').fill(testNote);
    await page.click('button:has-text("Save Notes")');

    // Should redirect back with saved banner
    await page.waitForURL('**/dashboard/integrations/intend?saved=1');
    await expect(page.locator('text=Notes saved.')).toBeVisible();

    // Note should persist
    await expect(page.locator('textarea[name="notes"]')).toHaveValue(testNote);
  });

  test('returns 404 for unknown integration', async ({ page }) => {
    const response = await page.goto('/dashboard/integrations/nonexistent');
    expect(response?.status()).toBe(404);
  });
});
