import { expect, test } from './fixtures';

test('a returning visitor is told when a new version has been installed, and can reload or wait', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 });
  // A reload starts the page already controlled by a worker, like a returning visitor.
  await page.reload();
  await expect(page.getByTestId('result-count')).toContainText('41 products');

  const banner = page.getByRole('status').filter({ hasText: 'new version' });
  // The new worker taking over is what the browser reports with this event.
  await expect(async () => {
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await expect(banner).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByTestId('result-count')).toContainText('41 products');
});
