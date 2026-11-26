import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_LIFETIME_MS, createMockMpesa, simReceipt, type MockMpesa, type SimOutcome } from '../src/mock/mpesaMock';
import { PaymentServiceError } from '../src/payment/types';

let mock: MockMpesa;
let n = 0;
const MSISDN = '254700000001';

function setup(outcome: SimOutcome, delaySec = 4) {
  mock.sim.set({ outcome, delaySec, windowSec: 75, latencyMs: 0 });
}
const push = (orderRef = 'DUKA-TEST01', key = `${orderRef}:1`, amount = 1500, msisdn = MSISDN) =>
  mock.initiateStkPush({ orderRef, idempotencyKey: key, msisdn, amount });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-10T09:00:00Z'));
  n++;
  mock = createMockMpesa({ serverKey: `t.server.${n}`, simKey: `t.sim.${n}` });
});
afterEach(() => vi.useRealTimers());

describe('mock M-Pesa service: outcomes', () => {
  it('success: pending until the customer answers, then a simulated receipt', async () => {
    setup('success', 4);
    const r = await push();
    if (r.kind !== 'accepted') throw new Error('expected accepted');
    expect(await mock.queryStatus(r.checkoutRequestId)).toEqual({ state: 'pending' });
    vi.advanceTimersByTime(4000);
    const s = await mock.queryStatus(r.checkoutRequestId);
    expect(s).toMatchObject({ state: 'success', resultCode: 0 });
    if (s.state === 'success') expect(s.receipt).toMatch(/^SIM[A-Z0-9]{7}$/);
  });

  it.each([
    ['cancelled', 1032],
    ['wrong_pin', 2001],
    ['insufficient_funds', 1],
    ['timeout', 1037],
  ] as const)('%s maps to Daraja-style code %i', async (outcome, code) => {
    setup(outcome, 2);
    const r = await push();
    if (r.kind !== 'accepted') throw new Error();
    vi.advanceTimersByTime(2000);
    expect(await mock.queryStatus(r.checkoutRequestId)).toMatchObject({ state: 'failed', reason: outcome, resultCode: code });
  });

  it('unreachable: the push itself fails', async () => {
    setup('unreachable');
    await expect(push()).rejects.toMatchObject({ name: 'PaymentServiceError', code: 'unreachable' });
  });

  it('delayed_paid: status API stays pending but the ledger knows', async () => {
    setup('delayed_paid', 5);
    const r = await push();
    if (r.kind !== 'accepted') throw new Error();
    vi.advanceTimersByTime(90_000);
    expect(await mock.queryStatus(r.checkoutRequestId)).toEqual({ state: 'pending' });
    expect(await mock.lookupPayment({ orderRef: 'DUKA-TEST01', msisdn: MSISDN })).toMatchObject({ state: 'paid', amount: 1500 });
  });

  it('silent: never answers; lookup says pending, then not_found once the prompt lapses', async () => {
    setup('silent');
    await push();
    vi.advanceTimersByTime(10_000);
    expect(await mock.lookupPayment({ orderRef: 'DUKA-TEST01', msisdn: MSISDN })).toEqual({ state: 'pending' });
    vi.advanceTimersByTime(PROMPT_LIFETIME_MS);
    expect(await mock.lookupPayment({ orderRef: 'DUKA-TEST01', msisdn: MSISDN })).toEqual({ state: 'not_found' });
  });

  it('manual: waits for the handset, and an unanswered prompt times out', async () => {
    setup('manual');
    const r = await push();
    if (r.kind !== 'accepted') throw new Error();
    expect(mock.livePrompts()).toHaveLength(1);
    mock.handsetRespond(r.checkoutRequestId, 'wrong_pin');
    expect(await mock.queryStatus(r.checkoutRequestId)).toMatchObject({ state: 'failed', reason: 'wrong_pin' });

    const r2 = await push('DUKA-TEST02');
    if (r2.kind !== 'accepted') throw new Error();
    vi.advanceTimersByTime(PROMPT_LIFETIME_MS);
    expect(await mock.queryStatus(r2.checkoutRequestId)).toMatchObject({ state: 'failed', reason: 'timeout' });
  });
});

describe('mock M-Pesa service: idempotency and duplicate protection', () => {
  it('the same idempotency key returns the same checkout request', async () => {
    setup('success');
    const a = await push('DUKA-TEST01', 'k1');
    const b = await push('DUKA-TEST01', 'k1');
    expect(a).toMatchObject({ kind: 'accepted', reused: false });
    expect(b).toMatchObject({ kind: 'accepted', reused: true });
    expect(a.kind === 'accepted' && b.kind === 'accepted' && a.checkoutRequestId === b.checkoutRequestId).toBe(true);
    expect(Object.keys(mock.server.get().requests)).toHaveLength(1);
  });

  it('a different key does not stack a second prompt while one is still live', async () => {
    setup('manual');
    const a = await push('DUKA-TEST01', 'k1');
    const b = await push('DUKA-TEST01', 'k2');
    expect(b).toMatchObject({ kind: 'accepted', reused: true });
    expect(a.kind === 'accepted' && b.kind === 'accepted' && a.checkoutRequestId === b.checkoutRequestId).toBe(true);
  });

  it('after a failure a new key creates a fresh request', async () => {
    setup('cancelled', 1);
    const a = await push('DUKA-TEST01', 'k1');
    vi.advanceTimersByTime(1000);
    const b = await push('DUKA-TEST01', 'k2');
    expect(b).toMatchObject({ kind: 'accepted', reused: false });
    expect(a.kind === 'accepted' && b.kind === 'accepted' && a.checkoutRequestId !== b.checkoutRequestId).toBe(true);
  });

  it('an order that is already paid cannot be charged again', async () => {
    setup('success', 1);
    const a = await push('DUKA-TEST01', 'k1');
    if (a.kind !== 'accepted') throw new Error();
    vi.advanceTimersByTime(1000);
    await mock.queryStatus(a.checkoutRequestId);
    const again = await push('DUKA-TEST01', 'k2');
    expect(again.kind).toBe('already_paid');
    expect(Object.keys(mock.server.get().payments)).toHaveLength(1);
  });

  it('stopping the wait abandons the request so a retry can start cleanly', async () => {
    setup('manual');
    const a = await push('DUKA-TEST01', 'k1');
    if (a.kind !== 'accepted') throw new Error();
    await mock.cancel(a.checkoutRequestId);
    expect(await mock.queryStatus(a.checkoutRequestId)).toMatchObject({ state: 'failed', reason: 'cancelled' });
    const b = await push('DUKA-TEST01', 'k2');
    expect(b).toMatchObject({ kind: 'accepted', reused: false });
  });

  it('rejects bad input at the boundary', async () => {
    setup('success');
    await expect(push('DUKA-TEST01', 'k', 10.5)).rejects.toBeInstanceOf(PaymentServiceError);
    await expect(push('DUKA-TEST01', 'k', 0)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(push('DUKA-TEST01', 'k', 100, '0712345678')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(mock.queryStatus('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a different amount for an order that already has requests', async () => {
    setup('cancelled', 1);
    await push('DUKA-TEST01', 'k1', 1500);
    vi.advanceTimersByTime(1000);
    await expect(push('DUKA-TEST01', 'k2', 1600)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('lookupPayment', () => {
  it('needs the matching phone number', async () => {
    setup('success', 1);
    const a = await push();
    if (a.kind !== 'accepted') throw new Error();
    vi.advanceTimersByTime(1000);
    expect(await mock.lookupPayment({ orderRef: 'DUKA-TEST01', msisdn: '254700000002' })).toEqual({ state: 'not_found' });
    expect(await mock.lookupPayment({ orderRef: 'DUKA-TEST01', msisdn: MSISDN })).toMatchObject({ state: 'paid' });
  });
  it('reports the definite failure of the latest attempt', async () => {
    setup('insufficient_funds', 1);
    await push();
    vi.advanceTimersByTime(1000);
    expect(await mock.lookupPayment({ orderRef: 'DUKA-TEST01', msisdn: MSISDN })).toEqual({ state: 'failed', reason: 'insufficient_funds' });
  });
  it('unknown orders are not found', async () => {
    setup('success');
    expect(await mock.lookupPayment({ orderRef: 'DUKA-NOPE00', msisdn: MSISDN })).toEqual({ state: 'not_found' });
  });
});

describe('simReceipt', () => {
  it('is deterministic and clearly simulated', () => {
    expect(simReceipt('abc')).toBe(simReceipt('abc'));
    expect(simReceipt('abc')).not.toBe(simReceipt('abd'));
    expect(simReceipt('abc')).toMatch(/^SIM[A-Z2-9]{7}$/);
  });
});
