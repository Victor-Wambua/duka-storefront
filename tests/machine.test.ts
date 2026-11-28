import { describe, expect, it } from 'vitest';
import { canSubmit, initialPayment, isBusy, paymentReducer, type PaymentEvent, type PaymentState } from '../src/payment/machine';
import type { ResultFailReason } from '../src/payment/types';

const run = (events: PaymentEvent[], from: PaymentState = initialPayment) => events.reduce(paymentReducer, from);

const submit: PaymentEvent = { type: 'submit', attempt: 1, idempotencyKey: 'DUKA-AAAAAA:1' };
const accepted: PaymentEvent = { type: 'accepted', checkoutRequestId: 'CR1', now: 1000, windowMs: 75_000 };
const awaiting = run([submit, accepted]);

describe('happy path', () => {
  it('idle -> requesting -> awaiting_customer -> paid', () => {
    expect(run([submit])).toEqual({ status: 'requesting', attempt: 1, idempotencyKey: 'DUKA-AAAAAA:1' });
    expect(awaiting).toMatchObject({ status: 'awaiting_customer', checkoutRequestId: 'CR1', startedAt: 1000, deadline: 76_000, polls: 0, offline: false });
    const paid = paymentReducer(awaiting, { type: 'status', result: { state: 'success', receipt: 'SIMABC1234', paidAt: 5000, resultCode: 0 } });
    expect(paid).toEqual({ status: 'paid', receipt: 'SIMABC1234', paidAt: 5000 });
  });
  it('pending polls only bump the poll counter', () => {
    const s = run([{ type: 'status', result: { state: 'pending' } }, { type: 'poll_failed' }], awaiting);
    expect(s).toMatchObject({ status: 'awaiting_customer', polls: 2 });
  });
  it('an order that is already paid short-circuits to paid', () => {
    expect(run([submit, { type: 'already_paid', receipt: 'SIMXYZ', paidAt: 9 }])).toMatchObject({ status: 'paid', receipt: 'SIMXYZ' });
  });
});

describe('every failure branch', () => {
  const reasons: ResultFailReason[] = ['cancelled', 'wrong_pin', 'insufficient_funds', 'timeout'];
  it.each(reasons)('customer-side result %s -> failed(%s)', (reason) => {
    const s = paymentReducer(awaiting, { type: 'status', result: { state: 'failed', reason, resultCode: 1, resultDesc: 'x' } });
    expect(s).toEqual({ status: 'failed', reason, attempt: 1 });
  });
  it('request could not be sent -> failed(unreachable) with detail', () => {
    expect(run([submit, { type: 'request_failed', detail: 'gateway down' }])).toEqual({
      status: 'failed', reason: 'unreachable', attempt: 1, detail: 'gateway down',
    });
    expect(run([submit, { type: 'request_failed' }])).toEqual({ status: 'failed', reason: 'unreachable', attempt: 1 });
  });
  it('stopping the wait locally is failed(cancelled)', () => {
    expect(paymentReducer(awaiting, { type: 'cancel' })).toEqual({ status: 'failed', reason: 'cancelled', attempt: 1 });
  });
  it('passing the deadline with no answer -> expired, outcome unknown', () => {
    expect(paymentReducer(awaiting, { type: 'deadline', now: 76_000 })).toEqual({
      status: 'expired', attempt: 1, checkoutRequestId: 'CR1', check: 'none',
    });
  });
  it('a deadline event before the deadline is ignored', () => {
    expect(paymentReducer(awaiting, { type: 'deadline', now: 75_999 })).toBe(awaiting);
  });
});

describe('double-submit and stray events are ignored', () => {
  it('cannot submit while requesting or awaiting', () => {
    const requesting = run([submit]);
    expect(paymentReducer(requesting, { ...submit, attempt: 2 })).toBe(requesting);
    expect(paymentReducer(awaiting, { ...submit, attempt: 2 })).toBe(awaiting);
  });
  it('cannot submit once paid', () => {
    const paid: PaymentState = { status: 'paid', receipt: 'R', paidAt: 1 };
    expect(canSubmit(paid)).toBe(false);
    expect(paymentReducer(paid, submit)).toBe(paid);
  });
  it('late status replies after a final state change nothing', () => {
    const failed = paymentReducer(awaiting, { type: 'cancel' });
    expect(paymentReducer(failed, { type: 'status', result: { state: 'success', receipt: 'R', paidAt: 1, resultCode: 0 } })).toBe(failed);
  });
  it('events from the wrong state are no-ops', () => {
    expect(paymentReducer(initialPayment, accepted)).toBe(initialPayment);
    expect(paymentReducer(initialPayment, { type: 'cancel' })).toBe(initialPayment);
    expect(paymentReducer(initialPayment, { type: 'deadline', now: 1e12 })).toBe(initialPayment);
    expect(paymentReducer(awaiting, { type: 'lookup_started' })).toBe(awaiting);
  });
  it('busy states are exactly requesting and awaiting', () => {
    expect(isBusy(initialPayment)).toBe(false);
    expect(isBusy(run([submit]))).toBe(true);
    expect(isBusy(awaiting)).toBe(true);
  });
});

describe('retry after failure', () => {
  it('a failed attempt can be retried with a new attempt number and key', () => {
    const failed = paymentReducer(awaiting, { type: 'cancel' });
    expect(canSubmit(failed)).toBe(true);
    const again = paymentReducer(failed, { type: 'submit', attempt: 2, idempotencyKey: 'DUKA-AAAAAA:2' });
    expect(again).toEqual({ status: 'requesting', attempt: 2, idempotencyKey: 'DUKA-AAAAAA:2' });
  });
  it('reset returns to idle from failed only', () => {
    const failed = paymentReducer(awaiting, { type: 'cancel' });
    expect(paymentReducer(failed, { type: 'reset' })).toEqual(initialPayment);
    expect(paymentReducer(awaiting, { type: 'reset' })).toBe(awaiting);
  });
});

describe('expired: the "I paid but it is still pending" recovery path', () => {
  const expired = paymentReducer(awaiting, { type: 'deadline', now: 80_000 });
  it('does not allow a new push until a check says nothing was paid', () => {
    expect(canSubmit(expired)).toBe(false);
    expect(paymentReducer(expired, submit)).toBe(expired);
    expect(paymentReducer(expired, { type: 'reset' })).toBe(expired);
  });
  it('lookup found the payment -> paid', () => {
    const s = run(
      [{ type: 'lookup_started' }, { type: 'lookup_result', result: { state: 'paid', receipt: 'SIMLATE', paidAt: 3, amount: 500 } }],
      expired,
    );
    expect(s).toEqual({ status: 'paid', receipt: 'SIMLATE', paidAt: 3 });
  });
  it('lookup says still pending -> stays expired, keeps blocking retries', () => {
    const s = run([{ type: 'lookup_started' }, { type: 'lookup_result', result: { state: 'pending' } }], expired);
    expect(s).toMatchObject({ status: 'expired', check: 'pending' });
    expect(canSubmit(s)).toBe(false);
  });
  it('lookup says not found -> retry is allowed, and so is reset', () => {
    const s = run([{ type: 'lookup_started' }, { type: 'lookup_result', result: { state: 'not_found' } }], expired);
    expect(s).toMatchObject({ status: 'expired', check: 'not_found' });
    expect(canSubmit(s)).toBe(true);
    expect(paymentReducer(s, { type: 'reset' })).toEqual(initialPayment);
    expect(paymentReducer(s, { type: 'submit', attempt: 2, idempotencyKey: 'k2' })).toMatchObject({ status: 'requesting', attempt: 2 });
  });
  it('lookup reveals a definite failure -> failed(reason)', () => {
    const s = run([{ type: 'lookup_started' }, { type: 'lookup_result', result: { state: 'failed', reason: 'wrong_pin' } }], expired);
    expect(s).toEqual({ status: 'failed', reason: 'wrong_pin', attempt: 1 });
  });
  it('lookup network error is surfaced and can be retried', () => {
    const s = run([{ type: 'lookup_started' }, { type: 'lookup_failed' }], expired);
    expect(s).toMatchObject({ status: 'expired', check: 'error' });
    expect(paymentReducer(s, { type: 'lookup_started' })).toMatchObject({ check: 'checking' });
  });
  it('lookup_started twice is idempotent', () => {
    const once = paymentReducer(expired, { type: 'lookup_started' });
    expect(paymentReducer(once, { type: 'lookup_started' })).toBe(once);
  });
});

describe('offline and resume', () => {
  it('flags offline while awaiting and clears it on reconnect', () => {
    const off = paymentReducer(awaiting, { type: 'connectivity', online: false });
    expect(off).toMatchObject({ offline: true });
    expect(paymentReducer(off, { type: 'connectivity', online: true })).toMatchObject({ offline: false });
    expect(paymentReducer(off, { type: 'connectivity', online: false })).toBe(off);
    expect(paymentReducer(initialPayment, { type: 'connectivity', online: false })).toBe(initialPayment);
  });
  it('resume re-enters awaiting with the original deadline', () => {
    const s = paymentReducer(initialPayment, {
      type: 'resume', attempt: 2, idempotencyKey: 'k', checkoutRequestId: 'CR9', startedAt: 10_000, now: 20_000, windowMs: 75_000,
    });
    expect(s).toMatchObject({ status: 'awaiting_customer', deadline: 85_000, checkoutRequestId: 'CR9', attempt: 2 });
  });
  it('resume after the deadline goes straight to expired', () => {
    const s = paymentReducer(initialPayment, {
      type: 'resume', attempt: 2, idempotencyKey: 'k', checkoutRequestId: 'CR9', startedAt: 10_000, now: 90_000, windowMs: 75_000,
    });
    expect(s).toMatchObject({ status: 'expired', check: 'none' });
  });
});

describe('live gateway endings', () => {
  it('a Daraja failure with no dedicated copy keeps its own description', () => {
    const s = paymentReducer(awaiting, { type: 'status', result: { state: 'failed', reason: 'declined', resultCode: 2029, resultDesc: 'Some Daraja words' } });
    expect(s).toEqual({ status: 'failed', reason: 'declined', attempt: 1, detail: 'Some Daraja words' });
  });

  it('a review result is its own state: not paid, not failed, not busy', () => {
    const s = paymentReducer(awaiting, { type: 'status', result: { state: 'review', flags: ['late_success'] } });
    expect(s).toEqual({ status: 'review', attempt: 1, checkoutRequestId: 'CR1', flags: ['late_success'], check: 'none' });
    expect(isBusy(s)).toBe(false);
    expect(canSubmit(s)).toBe(false);
  });

  it('review: checking again reports what the gateway says and never invents success', () => {
    const review = paymentReducer(awaiting, { type: 'status', result: { state: 'review', flags: ['late_success'] } });
    expect(paymentReducer(review, { type: 'lookup_started' })).toMatchObject({ status: 'review', check: 'checking' });
    expect(run([{ type: 'lookup_started' }, { type: 'lookup_result', result: { state: 'review', flags: ['late_success'] } }], review)).toMatchObject({ status: 'review', check: 'pending' });
    expect(run([{ type: 'lookup_started' }, { type: 'lookup_result', result: { state: 'not_found' } }], review)).toMatchObject({ status: 'review', check: 'pending' });
    expect(run([{ type: 'lookup_started' }, { type: 'lookup_failed' }], review)).toMatchObject({ status: 'review', check: 'error' });
    expect(run([{ type: 'lookup_result', result: { state: 'paid', receipt: 'MOCKX', paidAt: 9, amount: 1 } }], review)).toEqual({ status: 'paid', receipt: 'MOCKX', paidAt: 9 });
  });

  it('review ignores stray poll results and can be reset to the form', () => {
    const review = paymentReducer(awaiting, { type: 'status', result: { state: 'review', flags: [] } });
    expect(paymentReducer(review, { type: 'status', result: { state: 'success', receipt: 'MOCKX', paidAt: 1, resultCode: 0 } })).toBe(review);
    expect(paymentReducer(review, { type: 'reset' })).toEqual(initialPayment);
  });

  it('an expired request that the lookup finds under review becomes review', () => {
    const expired = paymentReducer(awaiting, { type: 'deadline', now: 76_000 });
    expect(run([{ type: 'lookup_started' }, { type: 'lookup_result', result: { state: 'review', flags: ['callback_query_mismatch'] } }], expired)).toMatchObject({
      status: 'review',
      flags: ['callback_query_mismatch'],
      check: 'none',
    });
  });

  it('late_watch is shown while the prompt window is closed, and cleared when the answer changes', () => {
    const watching = paymentReducer(awaiting, { type: 'status', result: { state: 'pending', phase: 'late_watch' } });
    expect(watching).toMatchObject({ status: 'awaiting_customer', phase: 'late_watch', polls: 1 });
    expect(paymentReducer(watching, { type: 'status', result: { state: 'pending' } })).not.toHaveProperty('phase');
  });

  it('request failures keep their own reason, and Retry-After', () => {
    expect(run([submit, { type: 'request_failed', reason: 'rate_limited', retryAfterSec: 42, detail: 'slow down' }])).toEqual({
      status: 'failed',
      reason: 'rate_limited',
      attempt: 1,
      detail: 'slow down',
      retryAfterSec: 42,
    });
    expect(run([submit, { type: 'request_failed', reason: 'over_cap' }])).toMatchObject({ reason: 'over_cap' });
    expect(canSubmit(run([submit, { type: 'request_failed', reason: 'over_cap' }]))).toBe(true);
  });

  it('the prompt end time rides along when the backend supplies one', () => {
    const s = run([submit, { ...accepted, promptEndsAt: 91_000 } as PaymentEvent]);
    expect(s).toMatchObject({ status: 'awaiting_customer', promptEndsAt: 91_000 });
  });
});
