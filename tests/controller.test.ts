import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentController, DEFAULT_BACKOFF_MS } from '../src/payment/controller';
import { createMockMpesa, type MockMpesa, type SimOutcome } from '../src/mock/mpesaMock';
import { PaymentServiceError, type PaymentService } from '../src/payment/types';

let mock: MockMpesa;
let n = 0;
const PARAMS = { orderRef: 'DUKA-CTRL01', attempt: 1, msisdn: '254700000001', amount: 1500 };

const sim = (outcome: SimOutcome, delaySec = 4) => mock.sim.set({ outcome, delaySec, windowSec: 75, latencyMs: 0 });
const make = (service: PaymentService = mock, windowMs = 75_000) => new PaymentController({ service, windowMs });
/** run timers and flush promises */
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-10T09:00:00Z'));
  n++;
  mock = createMockMpesa({ serverKey: `c.server.${n}`, simKey: `c.sim.${n}` });
});
afterEach(() => vi.useRealTimers());

describe('PaymentController: success', () => {
  it('requests, polls with backoff, and ends paid', async () => {
    sim('success', 4);
    const c = make();
    const spy = vi.spyOn(mock, 'queryStatus');
    await c.pay(PARAMS);
    expect(c.getState()).toMatchObject({ status: 'awaiting_customer', attempt: 1 });

    await tick(DEFAULT_BACKOFF_MS[0]! - 1);
    expect(spy).not.toHaveBeenCalled();
    await tick(1); // t=2s: poll 1, still pending
    expect(spy).toHaveBeenCalledTimes(1);
    expect(c.getState()).toMatchObject({ status: 'awaiting_customer', polls: 1 });
    await tick(3000); // t=5s: poll 2, customer answered at 4s
    expect(c.getState()).toMatchObject({ status: 'paid' });
    c.dispose();
  });

  it('stops polling once paid', async () => {
    sim('success', 1);
    const c = make();
    const spy = vi.spyOn(mock, 'queryStatus');
    await c.pay(PARAMS);
    await tick(10_000);
    const calls = spy.mock.calls.length;
    await tick(60_000);
    expect(spy.mock.calls.length).toBe(calls);
    c.dispose();
  });

  it('backoff grows then holds at the last interval', async () => {
    sim('silent');
    const c = make(mock, 600_000);
    const spy = vi.spyOn(mock, 'queryStatus');
    await c.pay(PARAMS);
    // cumulative: 2, 5, 9.5, 15.5, 23.5, then every 8s
    await tick(2000); expect(spy).toHaveBeenCalledTimes(1);
    await tick(3000); expect(spy).toHaveBeenCalledTimes(2);
    await tick(4500); expect(spy).toHaveBeenCalledTimes(3);
    await tick(6000); expect(spy).toHaveBeenCalledTimes(4);
    await tick(8000); expect(spy).toHaveBeenCalledTimes(5);
    await tick(8000); expect(spy).toHaveBeenCalledTimes(6);
    await tick(8000); expect(spy).toHaveBeenCalledTimes(7);
    c.dispose();
  });
});

describe('PaymentController: failure branches', () => {
  it.each(['cancelled', 'wrong_pin', 'insufficient_funds', 'timeout'] as const)('%s -> failed(%s)', async (outcome) => {
    sim(outcome, 3);
    const c = make();
    await c.pay(PARAMS);
    await tick(10_000);
    expect(c.getState()).toEqual({ status: 'failed', reason: outcome, attempt: 1 });
    c.dispose();
  });

  it('unreachable: the push is rejected -> failed(unreachable)', async () => {
    sim('unreachable');
    const c = make();
    await c.pay(PARAMS);
    expect(c.getState()).toMatchObject({ status: 'failed', reason: 'unreachable' });
    c.dispose();
  });

  it('a thrown network error on the push is also unreachable', async () => {
    const service: PaymentService = { ...mock, initiateStkPush: () => Promise.reject(new TypeError('Failed to fetch')) };
    const c = make(service);
    await c.pay(PARAMS);
    expect(c.getState()).toMatchObject({ status: 'failed', reason: 'unreachable', detail: 'Failed to fetch' });
    c.dispose();
  });

  it('transient poll errors do not end the payment', async () => {
    sim('success', 6);
    let calls = 0;
    const flaky: PaymentService = {
      ...mock,
      initiateStkPush: (r) => mock.initiateStkPush(r),
      queryStatus: (id) => (++calls <= 2 ? Promise.reject(new Error('network')) : mock.queryStatus(id)),
    };
    const c = make(flaky);
    await c.pay(PARAMS);
    await tick(5000);
    expect(c.getState()).toMatchObject({ status: 'awaiting_customer', polls: 2 });
    await tick(10_000);
    expect(c.getState()).toMatchObject({ status: 'paid' });
    c.dispose();
  });
});

describe('PaymentController: expiry and recovery', () => {
  it('stops waiting at the deadline and lands in expired', async () => {
    sim('silent');
    const c = make(mock, 20_000);
    await c.pay(PARAMS);
    await tick(19_000);
    expect(c.getState().status).toBe('awaiting_customer');
    await tick(1_500);
    expect(c.getState()).toMatchObject({ status: 'expired', check: 'none' });
    const spy = vi.spyOn(mock, 'queryStatus');
    await tick(60_000);
    expect(spy).not.toHaveBeenCalled(); // no more polling after expiry
    c.dispose();
  });

  it('delayed_paid: expired, then "check status" finds the payment', async () => {
    sim('delayed_paid', 5);
    const c = make(mock, 20_000);
    await c.pay(PARAMS);
    await tick(25_000);
    expect(c.getState()).toMatchObject({ status: 'expired' });
    await c.checkStatus({ orderRef: PARAMS.orderRef, msisdn: PARAMS.msisdn });
    expect(c.getState()).toMatchObject({ status: 'paid' });
    c.dispose();
  });

  it('silent: check says pending first, then nothing found, and only then a retry is allowed', async () => {
    sim('silent');
    const c = make(mock, 20_000);
    await c.pay(PARAMS);
    await tick(25_000);
    await c.checkStatus({ orderRef: PARAMS.orderRef, msisdn: PARAMS.msisdn });
    expect(c.getState()).toMatchObject({ status: 'expired', check: 'pending' });
    expect(await c.pay({ ...PARAMS, attempt: 2 })).toBe(false); // blocked

    await tick(40_000); // prompt lapses
    await c.checkStatus({ orderRef: PARAMS.orderRef, msisdn: PARAMS.msisdn });
    expect(c.getState()).toMatchObject({ status: 'expired', check: 'not_found' });
    sim('success', 1);
    expect(await c.pay({ ...PARAMS, attempt: 2 })).toBe(true);
    await tick(5000);
    expect(c.getState()).toMatchObject({ status: 'paid' });
    c.dispose();
  });

  it('check status surfaces a lookup failure', async () => {
    sim('silent');
    const c = make({ ...mock, initiateStkPush: (r) => mock.initiateStkPush(r), lookupPayment: () => Promise.reject(new Error('x')) }, 10_000);
    await c.pay(PARAMS);
    await tick(12_000);
    await c.checkStatus({ orderRef: PARAMS.orderRef, msisdn: PARAMS.msisdn });
    expect(c.getState()).toMatchObject({ status: 'expired', check: 'error' });
    c.dispose();
  });
});

describe('PaymentController: duplicates and retry', () => {
  it('a double click sends exactly one push', async () => {
    sim('success', 5);
    const c = make();
    const spy = vi.spyOn(mock, 'initiateStkPush');
    const [a, b] = await Promise.all([c.pay(PARAMS), c.pay(PARAMS)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(mock.server.get().requests)).toHaveLength(1);
    c.dispose();
  });

  it('cancel then retry reuses the order and never stacks prompts', async () => {
    sim('manual');
    const c = make();
    await c.pay(PARAMS);
    c.cancel();
    expect(c.getState()).toMatchObject({ status: 'failed', reason: 'cancelled' });
    await tick(0);
    sim('success', 2);
    await c.pay({ ...PARAMS, attempt: 2 });
    await tick(6000);
    expect(c.getState()).toMatchObject({ status: 'paid' });
    // one order, two attempts, one payment
    const { requests, payments } = mock.server.get();
    expect(Object.keys(requests)).toHaveLength(2);
    expect(Object.keys(payments)).toEqual([PARAMS.orderRef]);
    c.dispose();
  });

  it('a late answer for an old attempt does not leak into the new one', async () => {
    sim('manual');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const slow: PaymentService = {
      ...mock,
      initiateStkPush: (r) => mock.initiateStkPush(r),
      queryStatus: async (id) => {
        if (first) {
          first = false;
          await gate;
          return { state: 'success', receipt: 'STALE', paidAt: 1, resultCode: 0 };
        }
        return mock.queryStatus(id);
      },
    };
    const c = make(slow);
    await c.pay(PARAMS);
    await tick(2000); // first poll is now stuck on the gate
    c.cancel();
    sim('manual');
    await c.pay({ ...PARAMS, attempt: 2 });
    release();
    await tick(0);
    expect(c.getState()).toMatchObject({ status: 'awaiting_customer', attempt: 2 });
    c.dispose();
  });

  it('paying an order that is already paid goes straight to paid', async () => {
    sim('success', 1);
    const first = make();
    await first.pay(PARAMS);
    await tick(5000);
    expect(first.getState().status).toBe('paid');
    first.dispose();
    const second = make();
    await second.pay({ ...PARAMS, attempt: 2 });
    expect(second.getState()).toMatchObject({ status: 'paid' });
    second.dispose();
  });
});

describe('PaymentController: offline and resume', () => {
  it('pauses polling offline and polls immediately on reconnect', async () => {
    sim('success', 3);
    const c = make();
    const spy = vi.spyOn(mock, 'queryStatus');
    await c.pay(PARAMS);
    c.setOnline(false);
    expect(c.getState()).toMatchObject({ offline: true });
    await tick(20_000);
    expect(spy).not.toHaveBeenCalled();
    c.setOnline(true);
    await tick(0);
    expect(c.getState()).toMatchObject({ status: 'paid' });
    c.dispose();
  });

  it('expires while offline without hammering the network', async () => {
    sim('silent');
    const c = make(mock, 10_000);
    const spy = vi.spyOn(mock, 'queryStatus');
    await c.pay(PARAMS);
    c.setOnline(false);
    await tick(15_000);
    expect(c.getState()).toMatchObject({ status: 'expired' });
    expect(spy).not.toHaveBeenCalled();
    c.dispose();
  });

  it('resume re-attaches to an in-flight request after a reload', async () => {
    sim('success', 5);
    const first = make();
    const startedAt = Date.now();
    await first.pay(PARAMS);
    const id = (first.getState() as { checkoutRequestId: string }).checkoutRequestId;
    first.dispose();
    await tick(3000);

    const second = make();
    second.resume({ attempt: 1, orderRef: PARAMS.orderRef, checkoutRequestId: id, startedAt });
    expect(second.getState()).toMatchObject({ status: 'awaiting_customer', checkoutRequestId: id });
    await tick(4000);
    expect(second.getState()).toMatchObject({ status: 'paid' });
    second.dispose();
  });

  it('notifies the caller of the request id so it can be persisted', async () => {
    sim('success', 5);
    const onAttempt = vi.fn();
    const c = new PaymentController({ service: mock, onAttempt });
    await c.pay(PARAMS);
    expect(onAttempt).toHaveBeenCalledWith({ attempt: 1, checkoutRequestId: expect.stringMatching(/^ws_CO_SIM_/) });
    c.dispose();
  });
});

describe('PaymentController: live gateway behaviour', () => {
  const gwService = (over: Partial<PaymentService> = {}): PaymentService => ({
    initiateStkPush: vi.fn().mockResolvedValue({ kind: 'accepted', checkoutRequestId: 'pay_1', expiresAt: 0, reused: false, windowMs: 150_000, promptEndsAt: Date.now() + 90_000 }),
    queryStatus: vi.fn().mockResolvedValue({ state: 'pending' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    lookupPayment: vi.fn().mockResolvedValue({ state: 'not_found' }),
    pollSchedule: () => ({ backoffMs: [1500, 1500, 2000], windowMs: 150_000 }),
    ...over,
  });

  it('uses the Idempotency-Key it was given, and the provider, scenario and window the backend asks for', async () => {
    const service = gwService();
    const c = new PaymentController({ service, windowMs: 75_000 });
    await c.pay({ ...PARAMS, provider: 'gateway', scenario: 'wrong_pin', idempotencyKey: 'duka-key-1' });
    expect(service.initiateStkPush).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'duka-key-1', provider: 'gateway', scenario: 'wrong_pin' }));
    expect(c.getState()).toMatchObject({ status: 'awaiting_customer', deadline: Date.now() + 150_000, promptEndsAt: expect.any(Number) });
    c.dispose();
  });

  it('polls at the backend\'s own pace (1.5 s first), not the simulator\'s', async () => {
    const service = gwService();
    const c = new PaymentController({ service });
    await c.pay(PARAMS);
    await tick(1499);
    expect(service.queryStatus).not.toHaveBeenCalled();
    await tick(2);
    expect(service.queryStatus).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('does not poll while the page is hidden, and catches up straight away when it is shown', async () => {
    const service = gwService();
    const c = new PaymentController({ service });
    await c.pay(PARAMS);
    c.setVisible(false);
    await tick(30_000);
    expect(service.queryStatus).not.toHaveBeenCalled();
    c.setVisible(true);
    await tick(1);
    expect(service.queryStatus).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('stops polling for good once the payment is final', async () => {
    const service = gwService({ queryStatus: vi.fn().mockResolvedValue({ state: 'success', receipt: 'MOCKOK', paidAt: 1, resultCode: 0 }) });
    const c = new PaymentController({ service });
    await c.pay(PARAMS);
    await tick(2000);
    expect(c.getState().status).toBe('paid');
    await tick(120_000);
    expect(service.queryStatus).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('respects Retry-After on a rate-limited poll', async () => {
    const queryStatus = vi
      .fn()
      .mockRejectedValueOnce(new PaymentServiceError('rate_limited', 'slow', { retryAfterSec: 20 }))
      .mockResolvedValue({ state: 'pending' });
    const c = new PaymentController({ service: gwService({ queryStatus }) });
    await c.pay(PARAMS);
    await tick(1600); // first poll, rate limited
    expect(queryStatus).toHaveBeenCalledTimes(1);
    await tick(19_000);
    expect(queryStatus).toHaveBeenCalledTimes(1); // still waiting out Retry-After
    await tick(1500);
    expect(queryStatus).toHaveBeenCalledTimes(2);
    c.dispose();
  });

  it('a review result ends polling, is not paid, and "check again" can still find it paid', async () => {
    const service = gwService({
      queryStatus: vi.fn().mockResolvedValue({ state: 'review', flags: ['late_success'] }),
      lookupPayment: vi.fn().mockResolvedValue({ state: 'review', flags: ['late_success'] }),
    });
    const c = new PaymentController({ service });
    await c.pay(PARAMS);
    await tick(2000);
    expect(c.getState()).toMatchObject({ status: 'review', flags: ['late_success'] });
    await tick(60_000);
    expect(service.queryStatus).toHaveBeenCalledTimes(1);
    await c.checkStatus({ orderRef: PARAMS.orderRef, msisdn: PARAMS.msisdn, provider: 'gateway', amount: 1500 });
    expect(c.getState()).toMatchObject({ status: 'review', check: 'pending' });
    (service.lookupPayment as ReturnType<typeof vi.fn>).mockResolvedValue({ state: 'paid', receipt: 'MOCKLATE', paidAt: 5, amount: 1500 });
    await c.checkStatus({ orderRef: PARAMS.orderRef, msisdn: PARAMS.msisdn });
    expect(c.getState()).toMatchObject({ status: 'paid', receipt: 'MOCKLATE' });
    c.dispose();
  });

  it.each([
    ['rate_limited', { retryAfterSec: 33 }],
    ['over_cap', {}],
    ['rejected', {}],
  ] as const)('a %s answer to the push becomes failed(%s)', async (code, extra) => {
    const service = gwService({ initiateStkPush: () => Promise.reject(new PaymentServiceError(code, 'because', extra)) });
    const c = new PaymentController({ service });
    await c.pay(PARAMS);
    expect(c.getState()).toMatchObject({ status: 'failed', reason: code, detail: 'because', ...('retryAfterSec' in extra ? extra : {}) });
    c.dispose();
  });

  it('passes the gateway\'s CheckoutRequestID to the caller for persistence', async () => {
    const onAttempt = vi.fn();
    const service = gwService({ initiateStkPush: vi.fn().mockResolvedValue({ kind: 'accepted', checkoutRequestId: 'pay_1', expiresAt: 0, reused: false, darajaCheckoutId: 'ws_CO_MOCK_1' }) });
    const c = new PaymentController({ service, onAttempt });
    await c.pay(PARAMS);
    expect(onAttempt).toHaveBeenCalledWith({ attempt: 1, checkoutRequestId: 'pay_1', darajaCheckoutId: 'ws_CO_MOCK_1' });
    c.dispose();
  });
});
