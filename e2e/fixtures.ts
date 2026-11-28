import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

export const GATEWAY = 'https://mpesa-gateway.victorwambua004.workers.dev';

/**
 * Every test starts with the live gateway blocked, so the suite can never reach it (CI must not
 * call the real thing). Tests that exercise the gateway path register a stub with `stubGateway`,
 * which takes priority over this.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(`${GATEWAY}/**`, (route) => route.abort('connectionrefused'));
    await use(page);
  },
});
