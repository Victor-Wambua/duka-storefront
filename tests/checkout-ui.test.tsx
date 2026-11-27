import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAIL_COPY } from '../src/components/PaymentPanel';
import { mockMpesa, type SimOutcome } from '../src/mock/mpesaMock';
import { cartStore, inventoryStore, ordersStore, sessionStore } from '../src/state/stores';
import { expectNoA11yViolations, fakeUser, renderApp, resetWorld, seedCart } from './helpers';

type User = ReturnType<typeof fakeUser>;
const PHONE = '0700 000 001';
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-03-10T09:00:00Z'));
  resetWorld();
  seedCart();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function openCheckout() {
  const view = renderApp('/checkout');
  await screen.findByRole('heading', { level: 1, name: 'Checkout' });
  return view;
}

async function fillForm(user: User, phone = PHONE) {
  await user.type(screen.getByLabelText('Full name'), 'Wanjiru Test');
  await user.type(screen.getByLabelText('M-Pesa phone number'), phone);
  await user.type(screen.getByLabelText('Address or landmark'), 'Sample Estate, Kilimani');
}
const payButton = () => screen.getByRole('button', { name: /Pay KES.*with M-Pesa/ });

async function payWith(user: User, outcome: SimOutcome, extra: Partial<Parameters<typeof resetWorld>[0]> = {}) {
  mockMpesa.sim.set({ ...mockMpesa.sim.get(), outcome, ...extra });
  await fillForm(user);
  await user.click(payButton());
}

describe('checkout form', () => {
  it('explains problems next to each field and moves focus to the first invalid one', async () => {
    const user = fakeUser();
    await openCheckout();
    await user.click(payButton());
    const summary = screen.getByTestId('error-summary');
    expect(within(summary).getAllByRole('link')).toHaveLength(3);
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    const name = screen.getByLabelText('Full name');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/Enter your name/);
    expect(screen.getByLabelText('Address or landmark')).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(summary).getByRole('link', { name: /street, estate or landmark/ }));
    expect(screen.getByLabelText('Address or landmark')).toHaveFocus();
  });

  it('does not show a realistic sample number as a placeholder', async () => {
    await openCheckout();
    expect(screen.getByLabelText('M-Pesa phone number')).not.toHaveAttribute('placeholder');
  });

  it('normalises the phone number live', async () => {
    const user = fakeUser();
    await openCheckout();
    const input = screen.getByLabelText('M-Pesa phone number');
    await user.type(input, '+254 712 345');
    await user.tab();
    expect(screen.getByText(/too short/)).toBeInTheDocument();
    await user.type(input, ' 678');
    expect(screen.getByText('The prompt will go to 0712 345 678 (+254712345678).')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '0212345678');
    expect(screen.getByText(/start with 07 or 01/)).toBeInTheDocument();
  });

  it('shows an empty state when the cart is empty', async () => {
    cartStore.set({ lines: [], promoCode: null, areaId: null });
    renderApp('/checkout');
    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = await openCheckout();
    await expectNoA11yViolations(container);
  });
});

describe('M-Pesa STK push: success', () => {
  it('requesting, awaiting with a countdown, paid, then the receipt', async () => {
    const user = fakeUser();
    await openCheckout();
    mockMpesa.sim.set({ ...mockMpesa.sim.get(), latencyMs: 500 });
    await fillForm(user);
    await user.click(payButton());
    expect(screen.getByRole('heading', { name: 'Sending your payment request' })).toBeInTheDocument();
    await advance(600);
    expect(await screen.findByRole('heading', { name: 'Check your phone' })).toBeInTheDocument();
    expect(screen.getByText('0700 000 001')).toBeInTheDocument();
    expect(screen.getByTestId('countdown')).toHaveTextContent(/0:1\d/);
    expect(screen.getByRole('button', { name: 'Cancel payment' })).toBeInTheDocument();

    await advance(6000);
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    await advance(1600);
    expect(await screen.findByRole('heading', { level: 1, name: /your order is in/ })).toBeInTheDocument();
    expect(screen.getByTestId('mpesa-receipt')).toHaveTextContent(/^SIM[A-Z0-9]{7}$/);
    expect(screen.getByText('Paid')).toBeInTheDocument();

    const orders = ordersStore.get();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: 'paid', pricing: { subtotal: 370, deliveryFee: 200, total: 570 } });
    expect(cartStore.get().lines).toEqual([]);
    expect(sessionStore.get()).toBeNull();
    expect(inventoryStore.get().sold['maize-flour:1']).toBe(2);
  });

  it('a double click sends one request and makes one order', async () => {
    const user = fakeUser();
    await openCheckout();
    mockMpesa.sim.set({ ...mockMpesa.sim.get(), outcome: 'manual' });
    await fillForm(user);
    const spy = vi.spyOn(mockMpesa, 'initiateStkPush');
    const btn = payButton();
    await user.dblClick(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ordersStore.get()).toHaveLength(1);
  });
});

describe('M-Pesa STK push: every failure has its own message and a way forward', () => {
  it.each(['cancelled', 'wrong_pin', 'insufficient_funds', 'timeout'] as const)('%s', async (outcome) => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, outcome);
    await advance(8000);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: FAIL_COPY[outcome].title })).toBeInTheDocument();
    expect(within(alert).getByText(FAIL_COPY[outcome].body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Pay on delivery instead' })).toBeInTheDocument();
    expect(ordersStore.get()).toHaveLength(1);
    expect(ordersStore.get()[0]!.status).toBe('pending_payment');
  });

  it('unreachable', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'unreachable');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: FAIL_COPY.unreachable.title })).toBeInTheDocument();
  });

  it('cancel, then retry, then success: one order, one payment, two attempts', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'manual');
    await screen.findByRole('heading', { name: 'Check your phone' });
    await user.click(screen.getByRole('button', { name: 'Cancel payment' }));
    expect(await screen.findByRole('heading', { name: FAIL_COPY.cancelled.title })).toBeInTheDocument();

    mockMpesa.sim.set({ ...mockMpesa.sim.get(), outcome: 'success', delaySec: 2 });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await advance(5000);
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    await advance(1600);
    await screen.findByRole('heading', { level: 1, name: /your order is in/ });

    expect(ordersStore.get()).toHaveLength(1);
    expect(ordersStore.get()[0]!.payment.attempts).toBe(2);
    const { requests, payments } = mockMpesa.server.get();
    expect(Object.keys(requests)).toHaveLength(2);
    expect(Object.keys(payments)).toHaveLength(1);
  });

  it('"use a different number" returns to the form with focus on the phone field', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'cancelled');
    await advance(5000);
    await user.click(await screen.findByRole('button', { name: 'Use a different number' }));
    expect(screen.getByLabelText('M-Pesa phone number')).toHaveFocus();
  });

  it('can switch to pay on delivery after a failure, keeping the same order', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'insufficient_funds');
    await advance(5000);
    const ref = ordersStore.get()[0]!.ref;
    await user.click(await screen.findByRole('button', { name: 'Pay on delivery instead' }));
    expect(await screen.findByRole('heading', { level: 1, name: /your order is in/ })).toBeInTheDocument();
    expect(ordersStore.get()).toHaveLength(1);
    expect(ordersStore.get()[0]).toMatchObject({ ref, status: 'pay_on_delivery' });
  });
});

describe('M-Pesa STK push: no answer, and recovery', () => {
  it('stops waiting, refuses to double charge, and only offers a new prompt once nothing is found', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'silent');
    await screen.findByRole('heading', { name: 'Check your phone' });
    await advance(16_000);
    expect(await screen.findByRole('heading', { name: 'We have not heard back from M-Pesa' })).toBeInTheDocument();
    expect(screen.getByText(/do not pay again yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new prompt/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check payment status' }));
    expect(await screen.findByText(/Still processing/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new prompt/ })).not.toBeInTheDocument();

    await advance(61_000); // the prompt lapses on the handset
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/No payment was found for order DUKA-/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new prompt' })).toBeInTheDocument();
  });

  it('"I paid but it is pending": the lookup finds the payment', async () => {
    const user = fakeUser();
    await openCheckout();
    await payWith(user, 'delayed_paid');
    await advance(16_000);
    await screen.findByRole('heading', { name: 'We have not heard back from M-Pesa' });
    await user.click(screen.getByRole('button', { name: 'Check payment status' }));
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    await advance(1600);
    expect(await screen.findByText('Paid')).toBeInTheDocument();
    expect(ordersStore.get()[0]!.status).toBe('paid');
    expect(Object.keys(mockMpesa.server.get().payments)).toHaveLength(1);
  });
});

describe('offline behaviour', () => {
  it('explains that checkout needs a connection and disables paying', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await openCheckout();
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(screen.getAllByText(/offline/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Checkout needs a connection/).length).toBeGreaterThan(1); // banner + inline notice
    expect(payButton()).toBeDisabled();
  });

  it('keeps the cart editable offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const user = fakeUser();
    renderApp('/product/honey');
    act(() => void window.dispatchEvent(new Event('offline')));
    await user.click(screen.getByRole('button', { name: /Add to cart/ }));
    expect(screen.getByTestId('cart-count')).toHaveTextContent('3 items');
  });
});

describe('pay on delivery, receipts and order lookup', () => {
  it('places a pay-on-delivery order without touching the payment service', async () => {
    const user = fakeUser();
    await openCheckout();
    await fillForm(user);
    await user.click(screen.getByRole('radio', { name: /Pay on delivery/ }));
    const spy = vi.spyOn(mockMpesa, 'initiateStkPush');
    await user.click(screen.getByRole('button', { name: /Place order, pay on delivery/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /your order is in/ })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getAllByText('Pay on delivery').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Print receipt/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Items in order/ })).toBeInTheDocument();
    expect(cartStore.get().lines).toEqual([]);
  });
});

describe('orders page', () => {
  async function seedCodOrder() {
    const user = fakeUser();
    await openCheckout();
    await fillForm(user);
    await user.click(screen.getByRole('radio', { name: /Pay on delivery/ }));
    await user.click(screen.getByRole('button', { name: /Place order/ }));
    await screen.findByRole('heading', { level: 1, name: /your order is in/ });
    return ordersStore.get()[0]!.ref;
  }

  it('looks up by reference + phone', async () => {
    const ref = await seedCodOrder();
    document.body.innerHTML = '';
    const user = fakeUser();
    renderApp('/orders');
    await screen.findByRole('heading', { level: 1, name: 'Your orders' });
    expect(screen.getByRole('link', { name: new RegExp(ref) })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Order reference'), ref.toLowerCase());
    await user.type(screen.getByLabelText('Phone number'), '0700 000 002');
    await user.click(screen.getByRole('button', { name: 'Find order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No order on this device matches/);

    await user.clear(screen.getByLabelText('Phone number'));
    await user.type(screen.getByLabelText('Phone number'), '+254700000001');
    await user.click(screen.getByRole('button', { name: 'Find order' }));
    expect(await screen.findByRole('heading', { name: `Receipt ${ref}` })).toBeInTheDocument();
  });

  it('has no axe violations on the orders list or a receipt', async () => {
    const ref = await seedCodOrder();
    document.body.innerHTML = '';
    const a = renderApp('/orders');
    await screen.findByRole('heading', { level: 1, name: 'Your orders' });
    await expectNoA11yViolations(a.container);
    a.unmount();
    const b = renderApp(`/order/${ref}`);
    await screen.findByRole('heading', { name: `Receipt ${ref}` });
    await expectNoA11yViolations(b.container);
  });
});

describe('payment panel accessibility', () => {
  it('awaiting and failed panels have no axe violations', async () => {
    const user = fakeUser();
    const { container } = await openCheckout();
    await payWith(user, 'wrong_pin');
    await screen.findByRole('heading', { name: 'Check your phone' });
    await expectNoA11yViolations(container);
    await advance(8000);
    await screen.findByRole('button', { name: 'Try again' });
    await expectNoA11yViolations(container);
  });
});
