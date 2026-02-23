import { Page } from '@playwright/test';

export const TEST_USER_EMAIL = 'qtess@slapture.com';
export const TEST_USER_PASSWORD = 'qtess123';

export async function loginAsTestUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(TEST_USER_EMAIL);
  await page.locator('#password').fill(TEST_USER_PASSWORD);
  await page.locator('#submit-btn').click();
  // Wait for redirect to /widget (successful login)
  await page.waitForURL('**/widget', { timeout: 10000 });
}
