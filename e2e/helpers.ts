import { expect, type Page } from '@playwright/test';

export async function openSimulator(page: Page) {
  const toggle = page.getByRole('button', { name: 'Phone simulator', exact: true });
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return page.getByRole('dialog', { name: /Phone simulator/ });
}

export async function setOutcome(page: Page, label: string, delaySec = 1) {
  const sim = await openSimulator(page);
  await sim.getByLabel('What happens to the next payment').selectOption({ label });
  if (label !== 'I will answer on the phone') await sim.getByLabel(/Customer answers after/).fill(String(delaySec));
  await sim.getByLabel('Shop stops waiting after').selectOption('15');
  await page.getByRole('button', { name: 'Phone simulator', exact: true }).click(); // close
}

export async function addMaizeFlourAndOpenCheckout(page: Page) {
  await page.goto('./');
  await page.getByRole('link', { name: 'Maize flour', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Maize flour' })).toBeVisible();
  await page.getByRole('radio', { name: /2 kg/ }).check();
  await page.getByRole('button', { name: /Add to cart/ }).click();
  await expect(page.getByTestId('cart-count')).toContainText('1');
  await page.getByRole('button', { name: /Cart,/ }).click();
  const drawer = page.getByRole('dialog', { name: /Your cart/ });
  await drawer.getByLabel('Delivery or pickup area').selectOption('west');
  await expect(drawer.getByTestId('grand-total')).toContainText('KES 385'); // 185 + 200
  await drawer.getByRole('link', { name: /Checkout/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Checkout' })).toBeVisible();
}

export async function fillCheckout(page: Page) {
  await page.getByLabel('Full name').fill('Wanjiru Test');
  await page.getByLabel('M-Pesa phone number').fill('0700 000 001');
  await page.getByLabel('Address or landmark').fill('Sample Estate, Kilimani');
}

export async function readLocal<T>(page: Page, key: string): Promise<T> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null').data, key);
}
