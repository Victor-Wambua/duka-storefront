import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

export const GATEWAY = 'https://mpesa-gateway.victorwambua004.workers.dev';
/** The second instance, which talks to Safaricom's real Daraja sandbox. */
export const SANDBOX = 'https://gateway-sbx.victorwambua004.workers.dev';

/**
 * Every test starts with BOTH live gateways blocked (the mock-Daraja one and the Safaricom sandbox one), so
 * the suite can never reach either (CI must not call the real thing, and the sandbox would send a real prompt).
 * Tests that exercise a gateway path register a stub with `stubGateway` or `stubSandbox`, which takes priority.
 */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.route(`${GATEWAY}/**`, (route) => route.abort('connectionrefused'));
    await page.route(`${SANDBOX}/**`, (route) => route.abort('connectionrefused'));
    await provide(page);
  },
});
