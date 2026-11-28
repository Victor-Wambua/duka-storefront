import { expect, test } from './fixtures';
import { stubGateway } from './gatewayStub';
import { addMaizeFlourAndOpenCheckout, fillCheckout, readLocal, setScenario } from './helpers';

// The gateway is stubbed with page.route: these tests never reach the live service.

type Order = { ref: string; status: string; payment: { provider?: string; receipt: string | null; underReview?: boolean; gatewayPaymentId?: string } };

test('live gateway: pay, with the order number as reference and one Idempotency-Key; paid only when the gateway says so', async ({ page }) => {
  const stub = await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  await expect(page.getByRole('radio', { name: /Live gateway/ })).toBeChecked();
  await expect(page.getByText(/live sandbox gateway that runs a mock Daraja/)).toBeVisible(); // banner
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();

  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await expect(page.getByText(/no real prompt reaches your phone and no money moves/)).toBeVisible();
  await expect(page.getByTestId('gateway-payment-id')).toHaveText(/^pay_e2e/);
  await expect(page.getByTestId('gateway-checkout-id')).toHaveText(/^ws_CO_MOCK_/);
  await expect(page.getByRole('link', { name: /Inspect this payment/ })).toHaveAttribute('href', 'https://mpesa-gateway.victorwambua004.workers.dev/');
  // not paid while the gateway still says pending
  const early = await readLocal<Order[]>(page, 'duka.orders');
  expect(early[0]!.status).toBe('pending_payment');

  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('mpesa-receipt')).toHaveText(/^MOCK[A-Z0-9]{6}$/);
  await expect(page.getByText(/M-Pesa through the demo gateway/)).toBeVisible();

  const orders = await readLocal<Order[]>(page, 'duka.orders');
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: 'paid', payment: { provider: 'gateway' } });
  expect(stub.posts).toHaveLength(1);
  expect(stub.posts[0]!.body).toMatchObject({ amount: 385, phone: '254700000001', reference: orders[0]!.ref, scenario: 'success' });
  expect(stub.posts[0]!.headers['idempotency-key']).toMatch(/^duka-/);
  expect(stub.posts[0]!.headers.authorization).toMatch(/^Bearer pk_/);
});

test('live gateway: wrong PIN, then try again with a new payment and succeed', async ({ page }) => {
  const stub = await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  await setScenario(page, 'Wrong PIN');
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByRole('heading', { name: 'M-Pesa did not accept the PIN' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/result code 2001/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  expect((await readLocal<Order[]>(page, 'duka.orders'))[0]!.status).toBe('pending_payment');

  await setScenario(page, 'Customer pays');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible({ timeout: 10_000 });

  expect(stub.posts).toHaveLength(2);
  expect(stub.posts[1]!.headers['idempotency-key']).not.toBe(stub.posts[0]!.headers['idempotency-key']);
  expect(stub.posts[1]!.body.reference).toBe(stub.posts[0]!.body.reference);
  expect(await readLocal<Order[]>(page, 'duka.orders')).toHaveLength(1);
});

test('live gateway: a reload mid-payment resumes the same gateway payment', async ({ page }) => {
  const stub = await stubGateway(page, { delayMs: 6000 });
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /your order is in/ })).toBeVisible({ timeout: 25_000 });
  expect(stub.posts).toHaveLength(1);
});

test('live gateway: no callback ever arrives, so it ends timed out, and the order is not paid', async ({ page }) => {
  test.setTimeout(90_000);
  await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  await setScenario(page, 'Prompt times out (no callback)');
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByTestId('settling')).toBeVisible({ timeout: 20_000 }); // timed out; watching for a late result
  await expect(page.getByRole('heading', { name: 'The request timed out' })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Check order status' })).toBeVisible();
  const orders = await readLocal<Order[]>(page, 'duka.orders');
  expect(orders[0]!.status).toBe('pending_payment');
});

test('live gateway: callback and query disagree, so it is held for review: not paid, with a way back', async ({ page }) => {
  await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  await setScenario(page, 'Callback and query disagree');
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByRole('heading', { name: 'We are checking this payment' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/not marked as paid/)).toBeVisible();
  await expect(page.getByTestId('review-reasons')).toContainText('disagreed');
  await expect(page.getByRole('button', { name: /Try again|new prompt/ })).toHaveCount(0);

  const orders = await readLocal<Order[]>(page, 'duka.orders');
  expect(orders[0]).toMatchObject({ status: 'pending_payment', payment: { receipt: null, underReview: true } });

  await page.getByRole('button', { name: 'View my order' }).click();
  await expect(page.getByText('Payment under review.')).toBeVisible();
  await expect(page.getByText(/still holding this payment for review/)).toBeVisible();
  await expect(page.getByTestId('gateway-payment-id')).toHaveText(/^pay_e2e/);
  await expect(page.getByRole('button', { name: 'Check payment status' })).toBeVisible();
});

test('live gateway unreachable: says so, and the in-browser simulator still lets the visitor pay', async ({ page }) => {
  // The fixture blocks the gateway: everything fails like a dead network.
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  const issue = page.getByTestId('gateway-issue');
  await expect(issue).toContainText('not reachable right now');
  await expect(page.getByRole('button', { name: /Pay KES/ })).toBeDisabled();
  await issue.getByRole('button', { name: 'Use the in-browser simulator' }).click();
  await expect(page.getByRole('button', { name: /Pay KES/ })).toBeEnabled();
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('mpesa-receipt')).toHaveText(/^SIM[A-Z0-9]{7}$/);
});

test('live gateway rate limited: says so with a countdown, and offers the alternatives', async ({ page }) => {
  await stubGateway(page, { failCreate: 'rate_limited' });
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay KES 385 with M-Pesa/ }).click();
  await expect(page.getByRole('heading', { name: 'The gateway is rate limiting this demo' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Try again in \d+s/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Use the in-browser simulator' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay on delivery instead' })).toBeVisible();
});

test('a cart over the KES 1,000 demo cap is explained before any request', async ({ page }) => {
  const stub = await stubGateway(page);
  await addMaizeFlourAndOpenCheckout(page, 'gateway');
  await page.getByRole('button', { name: /Cart,/ }).click();
  const drawer = page.getByRole('dialog', { name: /Your cart/ });
  for (let i = 0; i < 4; i++) await drawer.getByRole('button', { name: /Increase quantity/ }).click();
  await drawer.getByRole('link', { name: /Checkout/ }).click();
  await expect(page.getByTestId('gateway-issue')).toContainText('over the KES 1,000 limit');
  await expect(page.getByRole('button', { name: /Pay KES/ })).toBeDisabled();
  expect(stub.posts).toHaveLength(0);
});
