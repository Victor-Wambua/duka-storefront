import { expect, test } from './fixtures';
import { addMaizeFlourAndOpenCheckout, fillCheckout, openSimulator, readLocal, setOutcome } from './helpers';

test('browse, add, check out, and pay by M-Pesa STK push', async ({ page }) => {
  await addMaizeFlourAndOpenCheckout(page);
  await setOutcome(page, 'Customer pays', 1);
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();

  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await expect(page.getByTestId('countdown')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('mpesa-receipt')).toHaveText(/^SIM[A-Z0-9]{7}$/);
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();

  const orders = await readLocal<{ status: string }[]>(page, 'duka.orders');
  expect(orders).toHaveLength(1);
  expect(orders[0]!.status).toBe('paid');
  await expect(page.getByTestId('cart-count')).toContainText('0');
});

test('cancel on the phone, retry, succeed: no duplicate orders or payments', async ({ page }) => {
  await addMaizeFlourAndOpenCheckout(page);
  await setOutcome(page, 'I will answer on the phone');
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();

  // play the customer: dismiss the prompt on the simulated handset
  const sim = await openSimulator(page);
  await sim.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payment cancelled' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();

  await sim.getByLabel('What happens to the next payment').selectOption({ label: 'Customer pays' });
  await sim.getByLabel(/Customer answers after/).fill('1');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible({ timeout: 10_000 });

  const orders = await readLocal<{ status: string; ref: string; payment: { attempts: number } }[]>(page, 'duka.orders');
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: 'paid', payment: { attempts: 2 } });
  const server = await readLocal<{ requests: Record<string, unknown>; payments: Record<string, unknown> }>(page, 'duka.mock.server');
  expect(Object.keys(server.requests)).toHaveLength(2);
  expect(Object.keys(server.payments)).toEqual([orders[0]!.ref]);
});

test('a reload mid-payment picks the same prompt back up', async ({ page }) => {
  await addMaizeFlourAndOpenCheckout(page);
  await setOutcome(page, 'Customer pays', 8);
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible({ timeout: 25_000 });
  const server = await readLocal<{ requests: Record<string, unknown> }>(page, 'duka.mock.server');
  expect(Object.keys(server.requests)).toHaveLength(1);
});

test('pay on delivery works as an alternative', async ({ page }) => {
  await addMaizeFlourAndOpenCheckout(page);
  await fillCheckout(page);
  await page.getByRole('radio', { name: /Pay on delivery/ }).check();
  await page.getByRole('button', { name: /Place order, pay on delivery/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible();
  await expect(page.getByText('Pay on delivery', { exact: true }).first()).toBeVisible();
});
