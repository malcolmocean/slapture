import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

const GOOGLE_TEST_ACCOUNT = process.env.GOOGLE_TEST_ACCOUNT || '';
const GOOGLE_TEST_ACCOUNT_PASSWORD = process.env.GOOGLE_TEST_ACCOUNT_PASSWORD || '';

test.describe('Sheets Routing', () => {
  test.skip(!GOOGLE_TEST_ACCOUNT || !GOOGLE_TEST_ACCOUNT_PASSWORD,
    'Requires GOOGLE_TEST_ACCOUNT and GOOGLE_TEST_ACCOUNT_PASSWORD env vars');

  // Mastermind LLM calls can be slow
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('routes weight entry to Sheets when connected, processes it regardless', async ({ page }) => {
    // Check if Sheets is connected for this user
    const authResponse = await page.request.get('/auth/status/sheets');
    const authStatus = await authResponse.json();
    const sheetsConnected = authStatus.connected;
    console.log(`Sheets connected: ${sheetsConnected}`);

    // Submit a capture that matches tabular data
    const response = await page.request.post('/capture', {
      data: { text: 'weight 84.5 kg' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Capture should be processed — any valid status is OK
    expect(body).toHaveProperty('captureId');

    // Fetch the capture to inspect routing decision
    const captureId = body.captureId;
    const statusResponse = await page.request.get(`/status/${captureId}`);
    const capture = await statusResponse.json();

    // Check the mastermind trace for what it decided
    const mastermindStep = capture.executionTrace?.find((s: any) => s.step === 'mastermind');
    if (mastermindStep?.output?.action === 'create') {
      const route = mastermindStep.output.route;
      console.log(`Mastermind created route: ${route.name} (${route.destinationType})`);

      if (sheetsConnected) {
        // When Sheets is connected, it should prefer sheets over fs
        expect(route.destinationType).toBe('sheets');
        expect(route.destinationConfig).toHaveProperty('spreadsheetId');
      }
    } else if (mastermindStep?.output?.action === 'route') {
      console.log(`Mastermind routed to existing: ${mastermindStep.output.routeId}`);
    } else if (mastermindStep?.output?.action === 'clarify') {
      console.log(`Mastermind asked for clarification: ${mastermindStep.output.question}`);
    } else {
      console.log(`Mastermind action: ${mastermindStep?.output?.action ?? 'no mastermind step'}`);
    }
  });

  test('routes baby memory to Sheets when connected, processes it regardless', async ({ page }) => {
    const authResponse = await page.request.get('/auth/status/sheets');
    const authStatus = await authResponse.json();
    const sheetsConnected = authStatus.connected;
    console.log(`Sheets connected: ${sheetsConnected}`);

    const response = await page.request.post('/capture', {
      data: { text: 'baby rolled over for the first time today' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('captureId');

    const captureId = body.captureId;
    const statusResponse = await page.request.get(`/status/${captureId}`);
    const capture = await statusResponse.json();

    const mastermindStep = capture.executionTrace?.find((s: any) => s.step === 'mastermind');
    if (mastermindStep?.output?.action === 'create') {
      const route = mastermindStep.output.route;
      console.log(`Mastermind created route: ${route.name} (${route.destinationType})`);

      if (sheetsConnected) {
        expect(route.destinationType).toBe('sheets');
        expect(route.destinationConfig).toHaveProperty('spreadsheetId');
      }
    } else {
      console.log(`Mastermind action: ${mastermindStep?.output?.action ?? 'no mastermind step'}`);
    }
  });
});
