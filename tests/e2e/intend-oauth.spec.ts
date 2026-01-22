// tests/e2e/intend-oauth.spec.ts
import { test, expect } from '@playwright/test';

// Test credentials from spec: username qtess, password q, auth_token 4yzflqxhxjjlwhfr06va
const TEST_INTEND_URL = process.env.INTEND_TEST_URL || 'https://intend.do';
const TEST_USERNAME = 'qtess';
const TEST_PASSWORD = 'q';

test.describe('intend.do OAuth Integration', () => {

  test.beforeEach(async ({ request }) => {
    // Clear any existing intend tokens
    await request.post('http://localhost:3000/disconnect/intend?token=dev-token');
  });

  test('complete OAuth flow and route capture', async ({ page, request }) => {
    // 1. Start OAuth flow
    await page.goto('http://localhost:3000/connect/intend');

    // 2. Should redirect to intend.do login
    await expect(page).toHaveURL(/intend\.do/);

    // 3. Log in with test credentials
    await page.fill('input[name="username"], input[type="text"]', TEST_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"], input[type="submit"]');

    // 4. Approve OAuth (if approval screen shown)
    const approveButton = page.locator('button:has-text("Approve"), button:has-text("Allow")');
    if (await approveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveButton.click();
    }

    // 5. Should redirect back to success page
    await expect(page).toHaveURL(/localhost:3000.*oauth\/success/);
    await expect(page.locator('body')).toContainText('Connected');

    // 6. Verify auth status shows connected
    const statusResponse = await request.get('http://localhost:3000/auth/status/intend?token=dev-token');
    const status = await statusResponse.json();
    expect(status.connected).toBe(true);

    // 7. Send a capture to intend route
    const captureResponse = await request.post('http://localhost:3000/capture?token=dev-token', {
      data: { text: 'intend: prepare amazon returns for tomorrow morning' }
    });
    const captureResult = await captureResponse.json();
    expect(captureResult.status).toBe('success');

    // 8. Verify capture executed successfully
    const captureStatusResponse = await request.get(
      `http://localhost:3000/status/${captureResult.captureId}?token=dev-token`
    );
    const capture = await captureStatusResponse.json();
    expect(capture.executionResult).toBe('success');
  });

  test('capture blocked when OAuth not configured', async ({ request }) => {
    // 1. Clear tokens (done in beforeEach)

    // 2. Verify not connected
    const statusResponse = await request.get('http://localhost:3000/auth/status/intend?token=dev-token');
    const status = await statusResponse.json();
    expect(status.connected).toBe(false);

    // 3. Send capture - should be blocked
    const captureResponse = await request.post('http://localhost:3000/capture?token=dev-token', {
      data: { text: 'intend: buy groceries' }
    });
    const captureResult = await captureResponse.json();

    // 4. Verify blocked
    const captureStatusResponse = await request.get(
      `http://localhost:3000/status/${captureResult.captureId}?token=dev-token`
    );
    const capture = await captureStatusResponse.json();
    expect(capture.executionResult).toBe('blocked_needs_auth');
  });

  test('blocked capture retryable after OAuth', async ({ page, request }) => {
    // 1. Create blocked capture first
    const captureResponse = await request.post('http://localhost:3000/capture?token=dev-token', {
      data: { text: 'intend: test retry functionality' }
    });
    const captureResult = await captureResponse.json();
    const captureId = captureResult.captureId;

    // Verify blocked
    let statusResp = await request.get(`http://localhost:3000/status/${captureId}?token=dev-token`);
    let capture = await statusResp.json();
    expect(capture.executionResult).toBe('blocked_needs_auth');

    // 2. Complete OAuth flow
    await page.goto('http://localhost:3000/connect/intend');
    await expect(page).toHaveURL(/intend\.do/);
    await page.fill('input[name="username"], input[type="text"]', TEST_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"], input[type="submit"]');

    const approveButton = page.locator('button:has-text("Approve"), button:has-text("Allow")');
    if (await approveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveButton.click();
    }

    await expect(page).toHaveURL(/localhost:3000.*oauth\/success/);

    // 3. Retry blocked capture
    const retryResponse = await request.post(
      `http://localhost:3000/retry/${captureId}?token=dev-token`
    );
    const retryResult = await retryResponse.json();
    expect(retryResult.capture.executionResult).toBe('success');

    // 4. Verify in blocked list is now empty
    const blockedResponse = await request.get('http://localhost:3000/captures/blocked?token=dev-token');
    const blocked = await blockedResponse.json();
    const stillBlocked = blocked.filter((c: any) => c.id === captureId);
    expect(stillBlocked.length).toBe(0);
  });
});
