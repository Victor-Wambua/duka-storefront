import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockMpesa } from '../src/mock/mpesaMock';
import type { ScenarioId } from '../src/gateway/scenarios';
import { cartStore, inventoryStore, ordersStore, providerStore, sessionStore } from '../src/state/stores';
import { installFakeGateway, type FakeGateway } from './fakeGateway';
import { expectNoA11yViolations, fakeUser, renderApp, resetWorld, seedCart } from './helpers';

type User = ReturnType<typeof fakeUser>;
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
/** Long waits in steps, so the page re-renders along the way like it does in a browser. */
const advanceSteps = async (total: number, step = 5000) => {
  for (let t = 0; t < total; t += step) await advance(Math.min(step, total - t));
};
const PHONE = '0700 000 001';
let gw: FakeGateway;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-28T09:00:00Z'));
  resetWorld({}, 'gateway');
  seedCart();
  gw = installFakeGateway();
});
afterEach(() => {
  gw.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const payButton = () => screen.getByRole('button', { name: /Pay KES.*with M-Pesa/ });

async function openCheckout() {
  const view = renderApp('/checkout');
  await screen.findByRole('heading', { level: 1, name: 'Checkout' });
  return view;
}
async function fillForm(user: User) {
  await user.type(screen.getByLabelText('Full name'), 'Wanjiru Test');
  await user.type(screen.getByLabelText('M-Pesa phone number'), PHONE);
  await user.type(screen.getByLabelText('Address or landmark'), 'Sample Estate, Kilimani');
}
async function payWith(user: User, scenario: ScenarioId = 'success') {
  providerStore.set((p) => ({ ...p, scenario }));
  await fillForm(user);
  await user.click(payButton());
}

describe('live gateway: the default provider', () => {
  it('is chosen by default, and the form says what is real and what is not', async () => {
    await openCheckout();
    expect(screen.getByRole('radio', { name: /Live gateway/ })).toBeChecked();
    expect(screen.getByText(/mock Daraja answers it\. No real prompt is sent/)).toBeInTheDocument();
    expect(screen.getByText(/The live gateway receives your phone number/)).toBeInTheDocument();
    expect(screen.getByText(/live sandbox gateway that runs a mock Daraja/)).toBeInTheDocument(); // banner
    await vi.waitFor(() => expect(gw.calls.map((c) => c.path)).toEqual(['/v1/config'])); // only the reachability probe
  });

  it('the choice is saved, and choosing the simulator changes the banner and sends nothing to the gateway', async () => {
    const user = fakeUser();
    await openCheckout();
    await user.click(screen.getByRole('radio', { name: /In-browser simulator/ }));
    expect(providerStore.get().choice).toBe('simulator');
    expect(JSON.parse(localStorage.getItem('duka.provider')!).data.choice).toBe('simulator');
    expect(screen.getByText(/payments are simulated in your browser/)).toBeInTheDocument();
    gw.calls.length = 0;
    mockMpesa.sim.set({ ...mockMpesa.sim.get(), delaySec: 1 });
    await fillForm(user);
    await user.click(payButton());
    await advance(5000);
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    expect(gw.calls).toEqual([]);
  });
});

describe('live gateway: success', () => {
  it('creates the payment with the order number as reference, shows honest copy while pending, and only then marks the order paid', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'success');

    expect(await screen.findByRole('heading', { name: 'Check your phone' })).toBeInTheDocument();
    const [post] = gw.posts();
    const order = ordersStore.get()[0]!;
    expect(post!.body).toEqual({ amount: 570, phone: '254700000001', reference: order.ref, scenario: 'success' });
    expect(post!.headers['Idempotency-Key']).toMatch(/^duka-/);
    expect(post!.headers.Authorization).toMatch(/^Bearer pk_/);
    // honest about what is simulated
    expect(screen.getByText(/no real prompt reaches your phone and no money moves/)).toBeInTheDocument();
    expect(screen.getByText('Customer pays')).toBeInTheDocument();
    // ids and the inspector link
    expect(screen.getByTestId('gateway-payment-id')).toHaveTextContent(/^pay_fake\d+/);
    expect(screen.getByTestId('gateway-checkout-id')).toHaveTextContent(/^ws_CO_MOCK_fake/);
    const link = screen.getByRole('link', { name: /Inspect this payment/ });
    expect(link).toHaveAttribute('href', 'https://mpesa-gateway.victorwambua004.workers.dev/');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByTestId('countdown')).toBeInTheDocument();

    // pending on the gateway: NOT paid yet
    await advance(1600);
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(inventoryStore.get().sold).toEqual({});

    await advance(3500);
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    expect(screen.getByText(/synthetic receipt from the mock Daraja/)).toBeInTheDocument();
    await advance(1600);
    expect(await screen.findByRole('heading', { level: 1, name: /your order is in/ })).toBeInTheDocument();
    expect(screen.getByTestId('mpesa-receipt')).toHaveTextContent(/^MOCK/);
    expect(screen.getByText(/M-Pesa through the demo gateway \(mock Daraja\)/)).toBeInTheDocument();
    expect(screen.getByTestId('gateway-payment-id')).toHaveTextContent(/^pay_fake\d+/);

    expect(ordersStore.get()).toHaveLength(1);
    expect(ordersStore.get()[0]).toMatchObject({ status: 'paid', payment: { provider: 'gateway', gatewayPaymentId: expect.stringMatching(/^pay_/) } });
    expect(inventoryStore.get().sold['maize-flour:1']).toBe(2);
    expect(cartStore.get().lines).toEqual([]);
    expect(gw.posts()).toHaveLength(1);
  });

  it('polls about every 1.5 s at first', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'timeout_no_callback');
    await screen.findByRole('heading', { name: 'Check your phone' });
    const gets = () => gw.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/v1/payments/')).length;
    await advance(1400);
    expect(gets()).toBe(0);
    await advance(200);
    expect(gets()).toBe(1);
    await advance(1600);
    expect(gets()).toBe(2);
  });

  it('a duplicate callback still ends as one success and one order', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'duplicate_callback');
    await advance(6000);
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    await advance(1600);
    expect(ordersStore.get()).toHaveLength(1);
    expect(gw.payments()).toHaveLength(1);
  });
});

describe('live gateway: one payment per attempt', () => {
  it('a double click sends one request', async () => {
    const user = fakeUser();
    await openCheckout();
    providerStore.set((p) => ({ ...p, scenario: 'timeout_no_callback' }));
    await fillForm(user);
    await user.dblClick(payButton());
    await screen.findByRole('heading', { name: 'Check your phone' });
    expect(gw.posts()).toHaveLength(1);
    expect(ordersStore.get()).toHaveLength(1);
  });

  it('the Idempotency-Key is saved before the request goes out, and a retry after a network failure reuses it', async () => {
    const user = fakeUser();
    await openCheckout();
    gw.failNext('network');
    await payWith(user, 'success');
    expect(await screen.findByRole('heading', { name: 'We could not reach the payment gateway' })).toBeInTheDocument();
    const first = gw.posts()[0]!.headers['Idempotency-Key'];
    expect(sessionStore.get()?.pendingKey?.key).toBe(first);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Check your phone' });
    expect(gw.posts()).toHaveLength(2);
    expect(gw.posts()[1]!.headers['Idempotency-Key']).toBe(first);
    expect(gw.payments()).toHaveLength(1);
    expect(sessionStore.get()?.pendingKey).toBeNull(); // answered: the next attempt gets a new key
  });

  it('a reload that sends the same request again gets the same payment back, not a second one', async () => {
    const user = fakeUser();
    const first = await openCheckout();
    providerStore.set((p) => ({ ...p, scenario: 'timeout_no_callback' }));
    await fillForm(user);
    // The response is lost: the request reaches the gateway but the page never sees the answer.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await realFetch(input, init);
      if (init?.method === 'POST') throw new TypeError('Failed to fetch');
      return res;
    });
    await user.click(payButton());
    await screen.findByRole('heading', { name: 'We could not reach the payment gateway' });
    expect(gw.payments()).toHaveLength(1);
    vi.stubGlobal('fetch', realFetch);
    first.unmount(); // the "reload"
    document.body.innerHTML = '';

    const user2 = fakeUser();
    await openCheckout();
    await fillForm(user2);
    await user2.click(payButton());
    await screen.findByRole('heading', { name: 'Check your phone' });
    const keys = gw.posts().map((p) => p.headers['Idempotency-Key']);
    expect(new Set(keys).size).toBe(1);
    expect(gw.payments()).toHaveLength(1);
  });

  it('a new attempt after an answered failure gets a new key and a new payment', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'wrong_pin');
    await advance(6000);
    await screen.findByRole('button', { name: 'Try again' });
    providerStore.set((p) => ({ ...p, scenario: 'success' }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Check your phone' });
    const keys = gw.posts().map((p) => p.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(ordersStore.get()).toHaveLength(1);
    expect(gw.posts()[1]!.body!.reference).toBe(gw.posts()[0]!.body!.reference);
  });

  it('a reload mid-payment picks the same gateway payment back up', async () => {
    const user = fakeUser();
    const first = await openCheckout();
    await payWith(user, 'success');
    await screen.findByRole('heading', { name: 'Check your phone' });
    first.unmount();
    document.body.innerHTML = '';
    renderApp('/checkout');
    expect(await screen.findByRole('heading', { name: 'Check your phone' })).toBeInTheDocument();
    expect(screen.getByTestId('gateway-payment-id')).toHaveTextContent(/^pay_fake\d+/);
    await advance(6000);
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    expect(gw.posts()).toHaveLength(1);
  });
});

describe('live gateway: every ending has honest copy', () => {
  it.each([
    ['wrong_pin', 'M-Pesa did not accept the PIN', /result code 2001/],
    ['insufficient_funds', 'Not enough M-Pesa balance', /result code 1\)/],
    ['cancelled_by_user', 'Payment cancelled', /result code 1032/],
  ] as const)('%s', async (scenario, title, body) => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, scenario);
    await advance(6000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: title })).toBeInTheDocument();
    expect(within(alert).getByText(body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(inventoryStore.get().sold).toEqual({});
  });

  it('an unlisted Daraja failure shows Daraja\'s own description', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'success');
    const id = (await screen.findByTestId('gateway-payment-id')).textContent!;
    gw.force(id, 'failed', { result_code: 2029, result_desc: 'The customer line is barred.' });
    await advance(2000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'M-Pesa declined the payment' })).toBeInTheDocument();
    expect(within(alert).getByText(/The customer line is barred\./)).toBeInTheDocument();
  });

  it('timeout: watches for a late result, says so, then ends as timed out and never as paid', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'timeout_no_callback');
    await advanceSteps(63_000);
    expect(await screen.findByTestId('settling')).toHaveTextContent(/prompt window has closed/);
    expect(screen.getByRole('heading', { name: 'Check your phone' })).toBeInTheDocument();
    await advanceSteps(32_000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'The request timed out' })).toBeInTheDocument();
    expect(within(alert).getByText(/holds it for review instead of marking it paid/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check order status' })).toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(inventoryStore.get().sold).toEqual({});
  });

  it('late success: it ends as "we are checking", the order is NOT paid, and there is a way back', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'late_success');
    await advanceSteps(97_000);
    expect(await screen.findByTestId('settling')).toBeInTheDocument();
    await advanceSteps(13_000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'We are checking this payment' })).toBeInTheDocument();
    expect(screen.getByTestId('review-reasons')).toHaveTextContent(/arrived after the payment had already timed out/);
    expect(screen.getByText(/not marked as paid/)).toBeInTheDocument();
    expect(screen.getByText(/please do not pay again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again|new prompt/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View my order' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();

    const order = ordersStore.get()[0]!;
    expect(order.status).toBe('pending_payment');
    expect(order.payment.underReview).toBe(true);
    expect(order.payment.receipt).toBeNull();
    expect(inventoryStore.get().sold).toEqual({});
    expect(cartStore.get().lines).not.toEqual([]);
  });

  it('callback and query disagree: held for review, with its own reason', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'callback_then_query_disagree');
    await advance(6000);
    expect(await screen.findByRole('heading', { name: 'We are checking this payment' })).toBeInTheDocument();
    expect(screen.getByTestId('review-reasons')).toHaveTextContent(/disagreed/);
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
  });

  it('review: "Check again" asks the gateway, and a payment that later succeeds is then recorded', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'callback_then_query_disagree');
    await advance(6000);
    await screen.findByRole('heading', { name: 'We are checking this payment' });
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Still held for review. Nothing has changed.')).toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');

    gw.force(gw.payments()[0]!.id, 'succeeded', { mpesa_receipt: 'MOCKLATE99' });
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    await advance(1600);
    expect(ordersStore.get()[0]).toMatchObject({ status: 'paid', payment: { receipt: 'MOCKLATE99' } });
  });

  it('review: "View my order" leaves the checkout for the order page, which asks the gateway again', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'callback_then_query_disagree');
    await advance(6000);
    await user.click(await screen.findByRole('button', { name: 'View my order' }));
    expect(await screen.findByText('Payment under review.')).toBeInTheDocument();
    expect(screen.getByText('Payment under review', { selector: '.status-badge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check payment status' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByText(/still holding this payment for review/)).toBeInTheDocument());
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
  });
});

describe('live gateway: it cannot be used', () => {
  it('unreachable at the start: says so plainly, blocks paying, offers the simulator and pay on delivery, and can check again', async () => {
    gw.setDown(true);
    const user = fakeUser();
    await openCheckout();
    const issue = await screen.findByTestId('gateway-issue');
    expect(issue).toHaveTextContent(/not reachable right now/);
    expect(issue).toHaveTextContent(/Nothing was charged/);
    expect(payButton()).toBeDisabled();
    expect(within(issue).getByRole('button', { name: 'Use the in-browser simulator' })).toBeInTheDocument();
    expect(within(issue).getByRole('button', { name: 'Pay on delivery instead' })).toBeInTheDocument();

    gw.setDown(false);
    await user.click(within(issue).getByRole('button', { name: 'Check again' }));
    await vi.waitFor(() => expect(screen.queryByTestId('gateway-issue')).not.toBeInTheDocument());
    expect(payButton()).toBeEnabled();
  });

  it('"use the simulator" from the notice switches provider and re-enables paying', async () => {
    gw.setDown(true);
    const user = fakeUser();
    await openCheckout();
    await user.click(within(await screen.findByTestId('gateway-issue')).getByRole('button', { name: 'Use the in-browser simulator' }));
    expect(providerStore.get().choice).toBe('simulator');
    expect(payButton()).toBeEnabled();
  });

  it('"pay on delivery" from the notice selects that method', async () => {
    gw.setDown(true);
    const user = fakeUser();
    await openCheckout();
    await user.click(within(await screen.findByTestId('gateway-issue')).getByRole('button', { name: 'Pay on delivery instead' }));
    expect(screen.getByRole('radio', { name: /Pay on delivery/ })).toBeChecked();
    expect(screen.getByRole('button', { name: /Place order, pay on delivery/ })).toBeEnabled();
  });

  it('over the KES 1,000 demo cap: says so before any request, and offers the simulator or pay on delivery', async () => {
    cartStore.set({ lines: [{ productId: 'maize-flour', variantId: 'maize-flour:1', qty: 8 }], promoCode: null, areaId: 'west' });
    const user = fakeUser();
    await openCheckout();
    const issue = await screen.findByTestId('gateway-issue');
    expect(issue).toHaveTextContent(/over the KES 1,000 limit/);
    expect(payButton()).toBeDisabled();
    expect(within(issue).queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    await user.click(within(issue).getByRole('button', { name: 'Use the in-browser simulator' }));
    expect(payButton()).toBeEnabled();
    expect(gw.posts()).toHaveLength(0);
  });

  it('the gateway answering over_cap after the push is explained too', async () => {
    gw.failNext('cap');
    const user = fakeUser();
    await openCheckout();
    await payWith(user);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Over the demo payment limit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use the in-browser simulator' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('rate limited: says so, holds "Try again" back for Retry-After, and offers the alternatives', async () => {
    gw.failNext('rate_limit', { retryAfter: '30' });
    const user = fakeUser();
    await openCheckout();
    await payWith(user);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'The gateway is rate limiting this demo' })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /Try again in \d+s/ });
    expect(retry).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use the in-browser simulator' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay on delivery instead' })).toBeInTheDocument();
    await advance(31_000);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('rate limited during polling: waits out Retry-After before asking again', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'timeout_no_callback');
    await screen.findByRole('heading', { name: 'Check your phone' });
    const realFetch = globalThis.fetch;
    let limited = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') === 'GET' && /\/v1\/payments\/pay_/.test(url) && limited === 0) {
        limited++;
        return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '20' } });
      }
      return realFetch(input, init);
    });
    const gets = () => gw.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/v1/payments/')).length;
    await advance(1600);
    expect(limited).toBe(1);
    await advance(15_000);
    expect(gets()).toBe(0); // the limited request never reached the stub; nothing else sent yet
    await advance(6000);
    expect(gets()).toBe(1);
    vi.stubGlobal('fetch', realFetch);
  });

  it('a validation error from the gateway is shown, not swallowed', async () => {
    gw.failNext('validation');
    const user = fakeUser();
    await openCheckout();
    await payWith(user);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'The gateway rejected the request' })).toBeInTheDocument();
    expect(within(alert).getByText(/phone must be a Kenyan mobile number/)).toBeInTheDocument();
  });

  it('pay on delivery never calls the gateway to create a payment', async () => {
    const user = fakeUser();
    await openCheckout();
    await fillForm(user);
    await user.click(screen.getByRole('radio', { name: /Pay on delivery/ }));
    await user.click(screen.getByRole('button', { name: /Place order, pay on delivery/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /your order is in/ })).toBeInTheDocument();
    expect(gw.posts()).toHaveLength(0);
  });
});

describe('Phone simulator mapped onto the gateway scenarios', () => {
  it('lists every mock scenario with a one-line explanation, and the choice is what gets sent', async () => {
    const user = fakeUser();
    await openCheckout();
    await user.click(screen.getByRole('button', { name: 'Phone simulator' }));
    const dialog = await screen.findByRole('dialog', { name: /Phone simulator/ });
    const select = within(dialog).getByLabelText('What the mock Daraja does next');
    const labels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual([
      'Customer pays',
      'Insufficient funds',
      'Wrong PIN',
      'Customer cancels',
      'Prompt times out (no callback)',
      'Duplicate callback',
      'Late success',
      'Callback and query disagree',
    ]);
    expect(within(dialog).getByTestId('scenario-hint')).toHaveTextContent(/success callback arrives in about 3 seconds/);
    await user.selectOptions(select, 'Wrong PIN');
    expect(within(dialog).getByTestId('scenario-hint')).toHaveTextContent(/2001/);
    expect(providerStore.get().scenario).toBe('wrong_pin');
    expect(within(dialog).queryByRole('group', { name: 'Simulated handset' })).not.toBeInTheDocument();

    await fillForm(user);
    await user.click(payButton());
    await screen.findByRole('heading', { name: 'Check your phone' });
    expect(gw.posts()[0]!.body!.scenario).toBe('wrong_pin');
  });

  it('with the in-browser simulator the original controls are back', async () => {
    resetWorld({}, 'simulator');
    seedCart();
    const user = fakeUser();
    await openCheckout();
    await user.click(screen.getByRole('button', { name: 'Phone simulator' }));
    const dialog = await screen.findByRole('dialog', { name: /Phone simulator/ });
    expect(within(dialog).getByLabelText('What happens to the next payment')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Simulated handset' })).toBeInTheDocument();
  });
});

describe('order lookup for gateway-paid orders', () => {
  async function reviewOrder() {
    const user = fakeUser();
    const view = await openCheckout();
    await payWith(user, 'callback_then_query_disagree');
    await advance(6000);
    await screen.findByRole('heading', { name: 'We are checking this payment' });
    view.unmount();
    document.body.innerHTML = '';
    return ordersStore.get()[0]!.ref;
  }

  it('the order page asks the gateway by reference and marks the order paid only when the gateway says succeeded', async () => {
    const ref = await reviewOrder();
    renderApp(`/order/${ref}`);
    expect(await screen.findByText(/still holding this payment for review/)).toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(gw.calls.some((c) => c.path.startsWith(`/v1/payments?reference=${ref}`))).toBe(true);

    gw.force(gw.payments()[0]!.id, 'succeeded', { mpesa_receipt: 'MOCKFOUND1' });
    const user = fakeUser();
    await user.click(screen.getByRole('button', { name: 'Check payment status' }));
    expect(await screen.findByText(/Payment found\. Your order is now marked as paid\./)).toBeInTheDocument();
    expect(ordersStore.get()[0]).toMatchObject({ status: 'paid', payment: { receipt: 'MOCKFOUND1' } });
    expect(inventoryStore.get().sold['maize-flour:1']).toBe(2);
    expect(screen.getByTestId('mpesa-receipt')).toHaveTextContent('MOCKFOUND1');
    expect(screen.getByRole('link', { name: /Inspect this payment/ })).toHaveAttribute('href', 'https://mpesa-gateway.victorwambua004.workers.dev/');
  });

  it('a failed payment found on lookup is reported as not paid', async () => {
    const ref = await reviewOrder();
    gw.force(gw.payments()[0]!.id, 'failed', { result_code: 2001 });
    renderApp(`/order/${ref}`);
    expect(await screen.findByText(/did not go through, so nothing is marked as paid/)).toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(ordersStore.get()[0]!.payment.underReview).toBe(false);
  });

  it('the orders page lookup also asks the gateway and the list shows the review state', async () => {
    const ref = await reviewOrder();
    renderApp('/orders');
    expect(await screen.findByText('Payment under review')).toBeInTheDocument();
    const user = fakeUser();
    await user.type(screen.getByLabelText('Order reference'), ref);
    await user.type(screen.getByLabelText('Phone number'), PHONE);
    await user.click(screen.getByRole('button', { name: 'Find order' }));
    expect(await screen.findByRole('heading', { name: `Receipt ${ref}` })).toBeInTheDocument();
  });
});

describe('accessibility of the gateway panels', () => {
  it('awaiting, review and failed have no axe violations', async () => {
    const user = fakeUser();
    const { container } = await openCheckout();
    await payWith(user, 'callback_then_query_disagree');
    await screen.findByRole('heading', { name: 'Check your phone' });
    await expectNoA11yViolations(container);
    await advance(6000);
    await screen.findByRole('heading', { name: 'We are checking this payment' });
    await expectNoA11yViolations(container);
  });

  it('the failed and gateway-issue states have no axe violations', async () => {
    const user = fakeUser();
    const { container } = await openCheckout();
    gw.failNext('rate_limit', { retryAfter: '30' });
    await payWith(user);
    await screen.findByRole('heading', { name: 'The gateway is rate limiting this demo' });
    await expectNoA11yViolations(container);
  });

  it('the form with the provider switch and an issue notice has no axe violations', async () => {
    gw.setDown(true);
    const { container } = await openCheckout();
    await screen.findByTestId('gateway-issue');
    await expectNoA11yViolations(container);
  });
});
