import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGatewayClient, GatewayError, type GatewayClient, type GatewayPayment } from '../src/gateway/client';
import { createGatewayService, failReason, GATEWAY_BACKOFF_MS, GATEWAY_WINDOW_MS, isGatewayId, LATE_WATCH_MS, toLookupResult, toStatusResult } from '../src/gateway/service';
import { createRoutingService } from '../src/payment/router';
import type { PaymentService, ProviderId } from '../src/payment/types';
import { installFakeGateway, type FakeGateway } from './fakeGateway';

const pay = (over: Partial<GatewayPayment> = {}): GatewayPayment => ({
  id: 'pay_1',
  reference: 'DUKA-AAAAAA',
  amount: 570,
  currency: 'KES',
  phone_masked: '2547****001',
  status: 'pending',
  created_at: '2026-11-28T12:00:00.000Z',
  updated_at: '2026-11-28T12:00:00.000Z',
  expires_at: '2026-11-28T12:01:30.000Z',
  flags: [],
  checkout_request_id: 'ws_CO_MOCK_x',
  ...over,
});

describe('toStatusResult: the gateway says it, we show it', () => {
  it('pending stays pending', () => expect(toStatusResult(pay())).toEqual({ state: 'pending' }));

  it('only `succeeded` is success, and it carries the receipt from the response', () => {
    expect(toStatusResult(pay({ status: 'succeeded', mpesa_receipt: 'MOCKABC123', result_code: 0, updated_at: '2026-11-28T12:00:03.000Z' }))).toEqual({
      state: 'success',
      receipt: 'MOCKABC123',
      paidAt: Date.parse('2026-11-28T12:00:03.000Z'),
      resultCode: 0,
    });
  });

  it('needs_review is a review, never a success, whatever the flags say', () => {
    for (const flags of [['late_success'], ['callback_query_mismatch'], ['push_outcome_unknown'], []]) {
      const r = toStatusResult(pay({ status: 'needs_review', flags, mpesa_receipt: 'MOCKSHOULDNOTCOUNT' }));
      expect(r.state).toBe('review');
    }
  });

  it.each([
    ['failed', 2001, 'wrong_pin'],
    ['failed', 1, 'insufficient_funds'],
    ['failed', 1032, 'cancelled'],
    ['failed', 1037, 'timeout'],
    ['failed', 2029, 'declined'],
    ['failed', undefined, 'declined'],
    ['cancelled', 1032, 'cancelled'],
    ['timed_out', 1037, 'timeout'],
  ] as const)('%s with code %s -> %s', (status, code, reason) => {
    const r = toStatusResult(pay({ status, ...(code !== undefined ? { result_code: code } : {}), result_desc: 'Daraja words' }));
    expect(r).toMatchObject({ state: 'failed', reason, resultDesc: 'Daraja words' });
    expect(failReason({ status, result_code: code })).toBe(reason);
  });
});

describe('toLookupResult: an order\'s payments, newest first', () => {
  it('nothing for the reference -> not_found', () => expect(toLookupResult([])).toEqual({ state: 'not_found' }));

  it('any succeeded payment makes the order paid, even if a later retry failed', () => {
    const r = toLookupResult([pay({ id: 'pay_2', status: 'failed', result_code: 2001 }), pay({ status: 'succeeded', mpesa_receipt: 'MOCKOK' })]);
    expect(r).toMatchObject({ state: 'paid', receipt: 'MOCKOK', amount: 570 });
  });

  it('otherwise the newest decides', () => {
    expect(toLookupResult([pay()])).toEqual({ state: 'pending' });
    expect(toLookupResult([pay({ status: 'needs_review', flags: ['late_success'] })])).toEqual({ state: 'review', flags: ['late_success'] });
    expect(toLookupResult([pay({ status: 'failed', result_code: 2001, result_desc: 'bad pin' })])).toEqual({ state: 'failed', reason: 'wrong_pin', detail: 'bad pin' });
  });

  it('a payment for a different amount is not this order\'s payment', () => {
    expect(toLookupResult([pay({ status: 'succeeded', amount: 100, mpesa_receipt: 'MOCKX' })], 570)).toEqual({ state: 'not_found' });
  });
});

describe('the live service against the stubbed gateway', () => {
  let gw: FakeGateway;
  const svc = () => createGatewayService({ client: createGatewayClient({ baseUrl: 'https://gw.test', key: 'pk_test' }) });
  const req = (over = {}) => ({ orderRef: 'DUKA-AAAAAA', idempotencyKey: 'k-12345678', msisdn: '254700000001', amount: 570, scenario: 'success', ...over });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T12:00:00Z'));
    gw = installFakeGateway();
  });
  afterEach(() => {
    gw.restore();
    vi.useRealTimers();
  });

  it('uses the order number as the reference and passes the scenario and the Idempotency-Key', async () => {
    const out = await svc().initiateStkPush(req());
    expect(out).toMatchObject({ kind: 'accepted', reused: false, windowMs: GATEWAY_WINDOW_MS, darajaCheckoutId: expect.stringMatching(/^ws_CO_MOCK/) });
    expect(isGatewayId((out as { checkoutRequestId: string }).checkoutRequestId)).toBe(true);
    const post = gw.posts()[0]!;
    expect(post.body).toEqual({ amount: 570, phone: '254700000001', reference: 'DUKA-AAAAAA', scenario: 'success' });
    expect(post.headers['Idempotency-Key']).toBe('k-12345678');
  });

  it('the same key and body returns the same payment and creates no second one', async () => {
    const a = (await svc().initiateStkPush(req())) as { checkoutRequestId: string };
    const b = (await svc().initiateStkPush(req())) as { checkoutRequestId: string; reused: boolean };
    expect(b.checkoutRequestId).toBe(a.checkoutRequestId);
    expect(b.reused).toBe(true);
    expect(gw.payments()).toHaveLength(1);
  });

  it('over the demo cap is refused before any request is made', async () => {
    await expect(svc().initiateStkPush(req({ amount: 1001 }))).rejects.toMatchObject({ code: 'over_cap' });
    expect(gw.calls).toHaveLength(0);
  });

  it('a gateway cap error, a rate limit with Retry-After, validation and an outage each get their own error', async () => {
    gw.failNext('cap');
    await expect(svc().initiateStkPush(req())).rejects.toMatchObject({ code: 'over_cap' });
    gw.failNext('rate_limit', { retryAfter: '42' });
    await expect(svc().initiateStkPush(req())).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 42 });
    gw.failNext('validation');
    await expect(svc().initiateStkPush(req())).rejects.toMatchObject({ code: 'rejected', message: expect.stringContaining('phone') });
    gw.failNext('server');
    await expect(svc().initiateStkPush(req())).rejects.toMatchObject({ code: 'unreachable' });
    gw.setDown(true);
    await expect(svc().initiateStkPush(req())).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('a payment already in flight for the order is followed, not duplicated', async () => {
    const first = (await svc().initiateStkPush(req())) as { checkoutRequestId: string };
    const second = (await svc().initiateStkPush(req({ idempotencyKey: 'k-other-9999' }))) as { checkoutRequestId: string; reused: boolean };
    expect(second).toMatchObject({ checkoutRequestId: first.checkoutRequestId, reused: true });
    expect(gw.payments()).toHaveLength(1);
  });

  it('a different body under the same key is rejected, not silently replaced', async () => {
    await svc().initiateStkPush(req());
    await expect(svc().initiateStkPush(req({ amount: 600 }))).rejects.toMatchObject({ code: 'rejected' });
  });

  it('polls to the real states: pending, then success with the receipt', async () => {
    const s = svc();
    const { checkoutRequestId } = (await s.initiateStkPush(req())) as { checkoutRequestId: string };
    expect(await s.queryStatus(checkoutRequestId)).toEqual({ state: 'pending' });
    await vi.advanceTimersByTimeAsync(3100);
    expect(await s.queryStatus(checkoutRequestId)).toMatchObject({ state: 'success', receipt: expect.stringMatching(/^MOCK/) });
  });

  it('a timed-out payment is watched for a late result before we call it timed out', async () => {
    const s = svc();
    const { checkoutRequestId } = (await s.initiateStkPush(req({ scenario: 'timeout_no_callback' }))) as { checkoutRequestId: string };
    await vi.advanceTimersByTimeAsync(62_000);
    expect(await s.queryStatus(checkoutRequestId)).toEqual({ state: 'pending', phase: 'late_watch' });
    await vi.advanceTimersByTimeAsync(LATE_WATCH_MS + 1);
    expect(await s.queryStatus(checkoutRequestId)).toMatchObject({ state: 'failed', reason: 'timeout' });
  });

  it('late_success: timed out first, then needs_review (never success)', async () => {
    const s = svc();
    const { checkoutRequestId } = (await s.initiateStkPush(req({ scenario: 'late_success' }))) as { checkoutRequestId: string };
    await vi.advanceTimersByTimeAsync(91_000);
    expect(await s.queryStatus(checkoutRequestId)).toEqual({ state: 'pending', phase: 'late_watch' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await s.queryStatus(checkoutRequestId)).toMatchObject({ state: 'review', flags: expect.arrayContaining(['late_success']) });
  });

  it('callback_then_query_disagree is a review', async () => {
    const s = svc();
    const { checkoutRequestId } = (await s.initiateStkPush(req({ scenario: 'callback_then_query_disagree' }))) as { checkoutRequestId: string };
    await vi.advanceTimersByTimeAsync(3100);
    expect(await s.queryStatus(checkoutRequestId)).toMatchObject({ state: 'review', flags: ['callback_query_mismatch'] });
  });

  it('a rate-limited poll carries Retry-After to the controller', async () => {
    const s = svc();
    const stub: GatewayClient = { ...s.client, getPayment: () => Promise.reject(new GatewayError('rate_limited', 'slow', { retryAfterSec: 9 })) };
    await expect(createGatewayService({ client: stub }).queryStatus('pay_x')).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 9 });
  });

  it('lookup by reference sees the payment and checks the amount', async () => {
    const s = svc();
    await s.initiateStkPush(req());
    await vi.advanceTimersByTimeAsync(3100);
    expect(await s.lookupPayment({ orderRef: 'DUKA-AAAAAA', msisdn: '254700000001', amount: 570 })).toMatchObject({ state: 'paid' });
    expect(await s.lookupPayment({ orderRef: 'DUKA-AAAAAA', msisdn: '254700000001', amount: 999 })).toEqual({ state: 'not_found' });
    expect(await s.lookupPayment({ orderRef: 'DUKA-NOPE22', msisdn: '254700000001' })).toEqual({ state: 'not_found' });
  });

  it('polls about every 1.5 s at first, then eases off', () => {
    expect(svc().pollSchedule?.('pay_abc')).toEqual({ backoffMs: GATEWAY_BACKOFF_MS, windowMs: GATEWAY_WINDOW_MS });
    expect(GATEWAY_BACKOFF_MS[0]).toBe(1500);
    expect(svc().pollSchedule?.('ws_CO_SIM_1')).toBeUndefined();
  });
});

describe('createRoutingService', () => {
  const fake = (name: string): PaymentService => ({
    initiateStkPush: vi.fn().mockResolvedValue({ kind: 'accepted', checkoutRequestId: `${name}-id`, expiresAt: 0, reused: false }),
    queryStatus: vi.fn().mockResolvedValue({ state: 'pending' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    lookupPayment: vi.fn().mockResolvedValue({ state: 'not_found' }),
    pollSchedule: vi.fn().mockReturnValue(undefined),
  });
  let sim: PaymentService, gate: PaymentService, sbx: PaymentService, current: ProviderId, router: PaymentService;
  beforeEach(() => {
    sim = fake('sim');
    gate = fake('gate');
    sbx = fake('sbx');
    current = 'gateway';
    router = createRoutingService({ simulator: sim, gateway: gate, sandbox: sbx, current: () => current });
  });
  const base = { orderRef: 'o', idempotencyKey: 'k', msisdn: '254700000001', amount: 1 };

  it('new payments follow the chosen provider', async () => {
    await router.initiateStkPush(base);
    current = 'simulator';
    await router.initiateStkPush(base);
    expect(gate.initiateStkPush).toHaveBeenCalledTimes(1);
    expect(sim.initiateStkPush).toHaveBeenCalledTimes(1);
  });

  it('an existing payment always goes back to the backend that made it, whatever is chosen now', async () => {
    current = 'simulator';
    await router.queryStatus('pay_123');
    await router.cancel('pay_123');
    await router.queryStatus('ws_CO_SIM_9');
    expect(gate.queryStatus).toHaveBeenCalledWith('pay_123');
    expect(gate.cancel).toHaveBeenCalledWith('pay_123');
    expect(sim.queryStatus).toHaveBeenCalledWith('ws_CO_SIM_9');
    router.pollSchedule?.('pay_123');
    expect(gate.pollSchedule).toHaveBeenCalledWith('pay_123');
  });

  it('a lookup uses the provider the order was paid with', async () => {
    current = 'gateway';
    await router.lookupPayment({ orderRef: 'o', msisdn: 'm', provider: 'simulator' });
    expect(sim.lookupPayment).toHaveBeenCalledTimes(1);
    expect(gate.lookupPayment).not.toHaveBeenCalled();
  });
});
