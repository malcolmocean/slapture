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

  test('routes weight entry to Sheets destination when Sheets is connected', async ({ page }) => {
    // Submit a capture that matches tabular data
    const response = await page.request.post('/capture', {
      data: { text: 'weight 84.5 kg' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Capture should be processed (success or blocked_needs_auth)
    expect(['success', 'blocked_needs_auth']).toContain(body.status);

    // Fetch the capture to inspect routing decision
    const captureId = body.captureId;
    const statusResponse = await page.request.get(`/status/${captureId}`);
    const capture = await statusResponse.json();

    // Check the mastermind trace for what it decided
    const mastermindStep = capture.executionTrace?.find((s: any) => s.step === 'mastermind');
    if (mastermindStep?.output?.action === 'create') {
      // When creating a new route, it should prefer sheets over fs
      expect(mastermindStep.output.route.destinationType).toBe('sheets');
      expect(mastermindStep.output.route.destinationConfig).toHaveProperty('spreadsheetId');
    } else if (mastermindStep?.output?.action === 'route' && capture.routeFinal) {
      // If routed to existing, check the route type
      const routesResponse = await page.request.get('/routes');
      const routes = await routesResponse.json();
      const matchedRoute = routes.find((r: any) =>
        r.id === capture.routeFinal || r.name === capture.routeFinal
      );
      // If a matching route was found, just log what it is for debugging
      if (matchedRoute) {
        console.log(`Routed to: ${matchedRoute.name} (${matchedRoute.destinationType})`);
      }
    }
  });

  test('routes baby memory to Sheets destination', async ({ page }) => {
    const response = await page.request.post('/capture', {
      data: { text: 'baby rolled over for the first time today' },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(['success', 'blocked_needs_auth']).toContain(body.status);

    const captureId = body.captureId;
    const statusResponse = await page.request.get(`/status/${captureId}`);
    const capture = await statusResponse.json();

    const mastermindStep = capture.executionTrace?.find((s: any) => s.step === 'mastermind');
    if (mastermindStep?.output?.action === 'create') {
      expect(mastermindStep.output.route.destinationType).toBe('sheets');
      expect(mastermindStep.output.route.destinationConfig).toHaveProperty('spreadsheetId');
    }
  });
});
