import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOX_WARNING } from '../src/gateway/sandbox';
import { inventoryStore, ordersStore, providerStore } from '../src/state/stores';
import { installFakeGateway, type FakeGateway, type SandboxOutcome } from './fakeGateway';
import { fakeUser, renderApp, resetWorld, seedCart } from './helpers';

// The Safaricom sandbox host is stubbed over fetch: these tests never reach it. The cancelled and
// no-response timelines are the ones the real sandbox showed; a success is a stand-in for the two real payments the owner completed (a small sample).

type User = ReturnType<typeof fakeUser>;
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const advanceSteps = async (total: number, step = 4000) => {
  for (let t = 0; t < total; t += step) await advance(Math.min(step, total - t));
};
const PHONE = '0700 000 001';
let gw: FakeGateway;

function setup(outcome: SandboxOutcome, phonePolicy?: 'any_number' | 'approved_numbers_only') {
  gw = installFakeGateway({ sandbox: { outcome, ...(phonePolicy ? { phonePolicy } : {}) } });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-28T09:00:00Z'));
  resetWorld({}, 'sandbox');
  seedCart(); // 2 x Maize flour, west: KES 570
});
afterEach(() => {
  gw?.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const payButton = () => screen.getByRole('button', { name: /test prompt with M-Pesa/ });
const ackBox = () => screen.getByRole('checkbox', { name: /I understand/ });

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
async function sendPrompt(user: User) {
  await fillForm(user);
  await user.click(ackBox());
  await user.click(payButton());
}

describe('safaricom sandbox: opt-in, warning and acknowledgement', () => {
  it('shows the plain-language warning and the KES 1 stand-in before checkout, with no pre-filled number', async () => {
    setup('success');
    await openCheckout();
    expect(screen.getByRole('radio', { name: /Safaricom sandbox \(real prompt on your phone\)/ })).toBeChecked();
    const warning = screen.getByTestId('sandbox-warning');
    expect(warning).toHaveTextContent(SANDBOX_WARNING);
    expect(screen.getByTestId('stand-in-note')).toHaveTextContent('Sandbox test charge: KES 1 stands in for the KES 570 order');
    const phone = screen.getByLabelText('M-Pesa phone number') as HTMLInputElement;
    expect(phone.value).toBe('');
    expect(phone.placeholder).toBe('');
    expect(screen.getByRole('button', { name: /Send a KES.1 test prompt with M-Pesa/ })).toBeInTheDocument();
  });

  it('keeps the pay button disabled until the acknowledgement is ticked, and sends nothing without it', async () => {
    const user = fakeUser();
    setup('success');
    await openCheckout();
    await fillForm(user);
    expect(payButton()).toBeDisabled();
    await user.click(payButton());
    expect(gw.posts()).toHaveLength(0);
    await user.click(ackBox());
    expect(payButton()).toBeEnabled();
    await user.click(ackBox());
    expect(payButton()).toBeDisabled();
  });

  it('never says no real prompt is sent or that no money moves while the sandbox is chosen', async () => {
    setup('success');
    await openCheckout();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/no real prompt is sent/i);
    expect(text).not.toMatch(/no money moves/i);
    expect(document.querySelector('.demo-banner')).toHaveTextContent(/sends a real prompt to the phone number you enter/);
  });

  it('does not offer a scenario picker in the Phone simulator panel', async () => {
    const user = fakeUser();
    setup('success');
    await openCheckout();
    await user.click(screen.getByRole('button', { name: 'Phone simulator' }));
    const dialog = await screen.findByRole('dialog', { name: /Phone simulator/ });
    expect(within(dialog).queryByLabelText('What the mock Daraja does next')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('sandbox-no-scenario')).toBeInTheDocument();
  });

  it('the choice is saved but the acknowledgement is not, and it must be ticked again on a new visit', async () => {
    const user = fakeUser();
    setup('success');
    const first = await openCheckout();
    await user.click(ackBox());
    expect(ackBox()).toBeChecked();
    expect(localStorage.getItem('duka.provider')).not.toMatch(/ack/i);
    expect(JSON.parse(localStorage.getItem('duka.provider')!).data).toEqual({ choice: 'sandbox', scenario: 'success' });
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toMatch(/acknowledg/i);
    }
    first.unmount();
    await openCheckout();
    expect(providerStore.get().choice).toBe('sandbox');
    expect(ackBox()).not.toBeChecked();
    expect(payButton()).toBeDisabled();
  });

  it('only shows the approved-numbers note when the gateway says its sandbox is restricted', async () => {
    setup('success', 'approved_numbers_only');
    await openCheckout();
    expect(await screen.findByTestId('approved-only-hint')).toHaveTextContent(/only accepts phone numbers its owner has approved/);
  });
});

describe('safaricom sandbox: real gateway states', () => {
  it('sends a flat KES 1 charge with no scenario, never the order total, and says so while pending', async () => {
    const user = fakeUser();
    setup('success');
    await openCheckout();
    await sendPrompt(user);
    expect(await screen.findByRole('heading', { name: 'Check your phone' })).toBeInTheDocument();
    const [post] = gw.posts();
    const order = ordersStore.get()[0]!;
    expect(post!.body).toEqual({ amount: 1, phone: '254700000001', reference: order.ref });
    expect(post!.body).not.toHaveProperty('scenario');
    expect(order.pricing.total).toBe(570);
    expect(screen.getByTestId('sandbox-pending')).toHaveTextContent(
      'Check your phone for an M-Pesa prompt and enter your PIN to approve it, or cancel it. This can take up to 2.5 minutes.',
    );
    const notes = screen.getAllByTestId('stand-in-note').map((n) => n.textContent);
    expect(notes).toContain('Sandbox test charge: KES\u00a01 stands in for the KES\u00a0570 order.');
    expect(screen.getByRole('link', { name: /Inspect this payment/ })).toHaveAttribute('href', 'https://gateway-sbx.victorwambua004.workers.dev/');
    // the ids shown are the gateway's own, without this app's routing tag
    expect(screen.getByTestId('gateway-payment-id')).toHaveTextContent(/^pay_fake\d+/);
    expect(ordersStore.get()[0]!.payment.gatewayPaymentId).toMatch(/^pay_fake/);
    expect(ordersStore.get()[0]!.payment.checkoutRequestId).toMatch(/^sbx:pay_fake/);
  });

  it('marks the order paid only when the gateway reports succeeded, labelled as a sandbox test', async () => {
    const user = fakeUser();
    setup('success');
    await openCheckout();
    await sendPrompt(user);
    await screen.findByRole('heading', { name: 'Check your phone' });
    await advance(3000);
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(inventoryStore.get().sold).toEqual({});

    await advance(4000);
    expect(await screen.findByRole('heading', { name: 'Paid (sandbox test)' })).toBeInTheDocument();
    expect(screen.getByText(/not checked whether a sandbox success debits a real wallet/)).toBeInTheDocument();
    await advance(1600);
    expect(await screen.findByRole('heading', { level: 1, name: /your order is in/ })).toBeInTheDocument();
    expect(screen.getByText('Paid (sandbox test)', { selector: '.status-badge' })).toBeInTheDocument();
    expect(screen.getByTestId('stand-in-note')).toHaveTextContent('Sandbox test charge: KES 1 stands in for the KES 570 order');
    expect(screen.getByText(/M-Pesa through the Safaricom sandbox \(real prompt, KES 1 test charge\)/)).toBeInTheDocument();
    expect(ordersStore.get()[0]).toMatchObject({ status: 'paid', payment: { provider: 'sandbox', chargedKes: 1 } });
    expect(ordersStore.get()[0]!.pricing.total).toBe(570);
    expect(gw.posts()).toHaveLength(1);
  });

  it('cancelled on the phone (1032): says so, the order stays unpaid, and a new prompt needs the acknowledgement again', async () => {
    const user = fakeUser();
    setup('cancelled');
    await openCheckout();
    await sendPrompt(user);
    await advanceSteps(12_000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'Prompt cancelled' })).toBeInTheDocument();
    expect(within(alert).getByText(/result code 1032/)).toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(inventoryStore.get().sold).toEqual({});

    await user.click(screen.getByRole('button', { name: 'Back to checkout to send a new prompt' }));
    expect(await screen.findByRole('button', { name: /test prompt with M-Pesa/ })).toBeDisabled();
    expect(ackBox()).not.toBeChecked();
    expect(gw.posts()).toHaveLength(1);
  });

  it('no response (1037): ends as "no response in time" without a settling wait, never paid', async () => {
    const user = fakeUser();
    setup('no_response');
    await openCheckout();
    await sendPrompt(user);
    await advanceSteps(30_000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'No response in time' })).toBeInTheDocument();
    expect(within(alert).getByText(/result code 1037/)).toBeInTheDocument();
    expect(screen.queryByTestId('settling')).not.toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
  });

  it('a failure the app has no special wording for shows Safaricom\'s own description', async () => {
    const user = fakeUser();
    setup('pending');
    await openCheckout();
    await sendPrompt(user);
    const id = (await screen.findByTestId('gateway-payment-id')).textContent!;
    gw.force(id, 'failed', { result_code: 2029, result_desc: 'The customer line is barred.' });
    await advance(5000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'The payment failed' })).toBeInTheDocument();
    expect(within(alert).getByText(/Safaricom reported: .The customer line is barred\./)).toBeInTheDocument();
  });

  it('needs_review is explained and never marks the order paid', async () => {
    const user = fakeUser();
    setup('pending');
    await openCheckout();
    await sendPrompt(user);
    const id = (await screen.findByTestId('gateway-payment-id')).textContent!;
    gw.force(id, 'needs_review', { flags: ['callback_query_mismatch'], mpesa_receipt: 'SBXSHOULDNOTCOUNT' });
    await advance(5000);
    expect(await screen.findByRole('heading', { name: 'We are checking this payment' })).toBeInTheDocument();
    expect(screen.getByText(/not marked as paid/)).toBeInTheDocument();
    expect(screen.getByText(/your own M-Pesa messages/)).toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
    expect(ordersStore.get()[0]!.payment.receipt).toBeNull();
  });

  it('403 phone_not_approved: says the sandbox is restricted and offers the mock gateway', async () => {
    const user = fakeUser();
    setup('phone_not_approved');
    await openCheckout();
    await sendPrompt(user);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'This sandbox only accepts approved numbers' })).toBeInTheDocument();
    expect(within(alert).getByText(/restricted to phone numbers its owner has approved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again|new prompt/ })).not.toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');

    await user.click(screen.getByRole('button', { name: 'Use the mock gateway' }));
    expect(providerStore.get().choice).toBe('gateway');
    expect(await screen.findByRole('radio', { name: /Live gateway/ })).toBeChecked();
  });

  it('rate limited (429): says so, no prompt was sent, offers the other providers', async () => {
    const user = fakeUser();
    setup('success');
    await openCheckout();
    await fillForm(user);
    await user.click(ackBox());
    gw.failNext('rate_limit', { retryAfter: '20' });
    await user.click(payButton());
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'The sandbox gateway is rate limiting this demo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use the mock gateway' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use the in-browser simulator' })).toBeInTheDocument();
  });

  it('unreachable before checkout: no prompt can be started, and the other providers are offered', async () => {
    setup('success');
    gw.setDown(true);
    await openCheckout();
    const issue = await screen.findByTestId('gateway-issue');
    expect(issue).toHaveTextContent(/Safaricom sandbox gateway is not reachable/);
    expect(issue).toHaveTextContent(/No prompt was sent/);
    expect(within(issue).getByRole('button', { name: 'Use the mock gateway' })).toBeInTheDocument();
    expect(within(issue).getByRole('button', { name: 'Use the in-browser simulator' })).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
  });
});
