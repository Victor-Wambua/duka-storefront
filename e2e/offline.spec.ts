import { expect, test } from '@playwright/test';

test('works offline: shell and catalogue load, cart works, checkout explains it needs a connection', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // wait until the worker controls the page and has finished precaching
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('result-count')).toContainText('41 products');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('result-count')).toContainText('41 products');
  await expect(page.getByText(/You are offline/)).toBeVisible();

  await page.getByRole('link', { name: 'Maize flour', exact: true }).click();
  await page.getByRole('button', { name: /Add to cart/ }).click();
  await expect(page.getByTestId('cart-count')).toContainText('1');

  await page.goto('./#/checkout');
  await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();
  await expect(page.getByText(/Checkout needs a connection/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay KES|Place order/ })).toBeDisabled();

  await context.setOffline(false);
  await expect(page.getByRole('button', { name: /Pay KES/ })).toBeEnabled();
});
