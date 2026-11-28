import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { stubGateway } from './gatewayStub';
import { stubSandbox } from './sandboxStub';
import { addMaizeFlourAndOpenCheckout, fillCheckout, openSimulator, readLocal } from './helpers';

// The Safaricom sandbox host is stubbed with page.route: these tests never reach it, so they can never send a real prompt.

type Order = { ref: string; status: string; pricing: { total: number }; payment: { provider?: string; receipt: string | null; chargedKes?: number } };

const WARNING =
  'This sends a real prompt to the phone number you enter. Use only your own number. Two KES 1 payments have been completed with a PIN here, which is a small sample, and we have not checked whether approving a sandbox prompt debits a real wallet. Safaricom sandbox, KES 1 test charge.';
const payButton = (page: Page) => page.getByRole('button', { name: /Send a KES.1 test prompt with M-Pesa/ });
const ack = (page: Page) => page.getByRole('checkbox', { name: /I understand/ });

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('the default provider is still the mock-Daraja gateway, and the sandbox is not touched', async ({ page }) => {
  const sbx = await stubSandbox(page);
  await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'default');
  await expect(page.getByRole('radio', { name: /Live gateway/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Safaricom sandbox \(real prompt/ })).not.toBeChecked();
  await expect(page.getByTestId('sandbox-warning')).toHaveCount(0);
  await expect(page.getByText(/no real prompt is sent and no money moves/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ })).toBeVisible();
  expect(sbx.requests).toEqual([]);
});

test('choosing the sandbox shows the warning, needs the acknowledgement, and has no scenario picker', async ({ page }) => {
  const sbx = await stubSandbox(page);
  await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'default');
  await page.getByRole('radio', { name: /Safaricom sandbox \(real prompt on your phone\)/ }).check();
  await expect(page.getByTestId('sandbox-warning')).toContainText(WARNING);
  await expect(page.getByTestId('sandbox-warning')).toContainText('Sandbox test charge: KES 1 stands in for the KES 385 order');
  // the demo bar no longer says nothing real happens
  await expect(page.locator('.demo-banner')).toContainText('sends a real prompt to the phone number you enter');
  await expect(page.locator('.demo-banner')).not.toContainText(/no money moves/i);
  await expect(page.getByLabel('M-Pesa phone number')).toHaveValue('');
  await expect(page.getByLabel('M-Pesa phone number')).not.toHaveAttribute('placeholder', /.+/);

  await fillCheckout(page);
  await expect(payButton(page)).toBeDisabled();
  await scan(page, 'sandbox checkout');
  await ack(page).check();
  await expect(payButton(page)).toBeEnabled();

  // no scenario picker for the sandbox
  const sim = await openSimulator(page);
  await expect(sim.getByLabel('What the mock Daraja does next')).toHaveCount(0);
  await expect(sim.getByTestId('sandbox-no-scenario')).toBeVisible();
  await page.getByRole('button', { name: 'Phone simulator', exact: true }).click();

  // only the reachability probe has gone to the sandbox so far, and the choice (not the tick) survives a reload
  expect(sbx.posts).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole('radio', { name: /Safaricom sandbox \(real prompt/ })).toBeChecked();
  await expect(ack(page)).not.toBeChecked();
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).not.toMatch(/acknowledg|\back\b/i);
});

test('a request without a phone number cannot be submitted, and neither can one without the acknowledgement', async ({ page }) => {
  const sbx = await stubSandbox(page);
  await addMaizeFlourAndOpenCheckout(page, 'sandbox');
  await page.getByLabel('Full name').fill('Wanjiru Test');
  await page.getByLabel('Address or landmark').fill('Sample Estate, Kilimani');
  await ack(page).check();
  await payButton(page).click();
  await expect(page.getByTestId('error-summary')).toContainText(/M-Pesa number/);
  await expect(page.getByLabel('M-Pesa phone number')).toBeFocused();
  expect(sbx.posts).toHaveLength(0);
  await ack(page).uncheck();
  await page.getByLabel('M-Pesa phone number').fill('0700 000 001');
  await expect(payButton(page)).toBeDisabled();
  expect(sbx.posts).toHaveLength(0);
});

test('sandbox success (stubbed): a flat KES 1, paid (sandbox test) only when the gateway says succeeded', async ({ page }) => {
  const sbx = await stubSandbox(page, { ending: 'success' });
  await addMaizeFlourAndOpenCheckout(page, 'sandbox');
  await fillCheckout(page);
  await ack(page).check();
  await payButton(page).click();

  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await expect(page.getByTestId('sandbox-pending')).toHaveText(
    'Check your phone for an M-Pesa prompt and enter your PIN to approve it, or cancel it. This can take up to 2.5 minutes.',
  );
  await expect(page.getByTestId('stand-in-note').last()).toContainText('Sandbox test charge: KES 1 stands in for the KES 385 order');
  await expect(page.getByRole('link', { name: /Inspect this payment/ })).toHaveAttribute('href', 'https://gateway-sbx.victorwambua004.workers.dev/');
  await scan(page, 'sandbox pending');
  expect((await readLocal<Order[]>(page, 'duka.orders'))[0]!.status).toBe('pending_payment');

  await expect(page.getByRole('heading', { name: 'Paid (sandbox test)' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.status-badge')).toHaveText('Paid (sandbox test)');
  await expect(page.getByTestId('stand-in-note')).toContainText('Sandbox test charge: KES 1 stands in for the KES 385 order');
  await expect(page.getByText(/not checked whether/).first()).toBeVisible();

  const orders = await readLocal<Order[]>(page, 'duka.orders');
  expect(orders[0]).toMatchObject({ status: 'paid', pricing: { total: 385 }, payment: { provider: 'sandbox', chargedKes: 1 } });
  expect(sbx.posts).toHaveLength(1);
  expect(sbx.posts[0]!.body).toMatchObject({ amount: 1, phone: '254700000001', reference: orders[0]!.ref });
  expect(sbx.posts[0]!.body).not.toHaveProperty('scenario');
  expect(sbx.posts[0]!.headers['idempotency-key']).toMatch(/^duka-/);
});

test('sandbox cancelled on the phone (1032): said plainly, the order stays unpaid, a new prompt needs a new tick', async ({ page }) => {
  await stubSandbox(page, { ending: 'cancelled_1032' });
  await addMaizeFlourAndOpenCheckout(page, 'sandbox');
  await fillCheckout(page);
  await ack(page).check();
  await payButton(page).click();
  await expect(page.getByRole('heading', { name: 'Prompt cancelled' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/result code 1032/)).toBeVisible();
  expect((await readLocal<Order[]>(page, 'duka.orders'))[0]!.status).toBe('pending_payment');
  await page.getByRole('button', { name: 'Back to checkout to send a new prompt' }).click();
  await expect(payButton(page)).toBeDisabled();
  await expect(ack(page)).not.toBeChecked();
});

test('sandbox no response (1037): "no response in time", not paid', async ({ page }) => {
  await stubSandbox(page, { ending: 'no_response_1037' });
  await addMaizeFlourAndOpenCheckout(page, 'sandbox');
  await fillCheckout(page);
  await ack(page).check();
  await payButton(page).click();
  await expect(page.getByRole('heading', { name: 'No response in time' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/result code 1037/)).toBeVisible();
  expect((await readLocal<Order[]>(page, 'duka.orders'))[0]!.status).toBe('pending_payment');
});

test('sandbox 403 phone_not_approved: explains the restriction and offers the mock gateway', async ({ page }) => {
  await stubSandbox(page, { ending: 'phone_not_approved' });
  await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'sandbox');
  await fillCheckout(page);
  await ack(page).check();
  await payButton(page).click();
  await expect(page.getByRole('heading', { name: 'This sandbox only accepts approved numbers' })).toBeVisible();
  await expect(page.getByText(/restricted to phone numbers its owner has approved/)).toBeVisible();
  await scan(page, 'sandbox not approved');
  await page.getByRole('button', { name: 'Use the mock gateway' }).click();
  await expect(page.getByRole('radio', { name: /Live gateway/ })).toBeChecked();
  await expect(page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ })).toBeEnabled();
});

test('sandbox unreachable: says so and offers the other providers', async ({ page }) => {
  // The fixture blocks the sandbox host: everything fails like a dead network.
  await addMaizeFlourAndOpenCheckout(page, 'sandbox');
  const issue = page.getByTestId('gateway-issue');
  await expect(issue).toContainText('Safaricom sandbox gateway is not reachable');
  await expect(issue.getByRole('button', { name: 'Use the mock gateway' })).toBeVisible();
  await expect(issue.getByRole('button', { name: 'Use the in-browser simulator' })).toBeVisible();
});
