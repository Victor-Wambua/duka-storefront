import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addMaizeFlourAndOpenCheckout, fillCheckout } from './helpers';

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(
    results.violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations on the key pages (${scheme}, real colour contrast)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('./');
    await expect(page.getByTestId('result-count')).toBeVisible();
    await scan(page, 'shop');

    await page.goto('./#/product/kanga-cloth');
    await expect(page.getByRole('heading', { level: 1, name: 'Kanga cloth' })).toBeVisible();
    await scan(page, 'product');

    await addMaizeFlourAndOpenCheckout(page);
    await scan(page, 'checkout');

    await page.getByRole('button', { name: /Cart,/ }).click();
    await expect(page.getByRole('dialog', { name: /Your cart/ })).toBeVisible();
    await scan(page, 'cart drawer');
    await page.getByRole('button', { name: /Close/ }).click();

    await fillCheckout(page);
    await page.getByRole('radio', { name: /Pay on delivery/ }).check();
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible();
    await scan(page, 'receipt');

    await page.goto('./#/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Your orders' })).toBeVisible();
    await scan(page, 'orders');
  });
}

test('axe: the payment states (awaiting, expired) and the simulator', async ({ page }) => {
  await addMaizeFlourAndOpenCheckout(page);
  await fillCheckout(page);
  const toggle = page.getByRole('button', { name: 'Phone simulator' });
  await toggle.click();
  const sim = page.getByRole('complementary', { name: /Phone simulator/ });
  await sim.getByLabel('What happens to the next payment').selectOption({ label: 'Never answers' });
  await sim.getByLabel('Shop stops waiting after').selectOption('15');
  await scan(page, 'simulator');
  await toggle.click();
  await page.getByRole('button', { name: /Pay KES/ }).click();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await scan(page, 'awaiting');
  await expect(page.getByRole('heading', { name: 'We have not heard back from M-Pesa' })).toBeVisible({ timeout: 25_000 });
  await scan(page, 'expired');
});
