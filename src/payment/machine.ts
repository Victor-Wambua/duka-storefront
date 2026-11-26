import type { FailReason, LookupResult, StatusResult } from './types';

/**
 * The payment state machine, as a pure reducer.
 *
 *   idle -> requesting -> awaiting_customer -> paid
 *                 |              |-> failed(cancelled | wrong_pin | insufficient_funds | timeout)
 *                 |              |-> expired  (we stopped waiting; outcome unknown)
 *                 '-> failed(unreachable)
 *
 * Time and I/O live in the controller; this file only decides what each event
 * means in each state. Events that make no sense in the current state return
 * the same state object, which is how double-submits and late replies are
 * ignored.
 */

export type ExpiredCheck = 'none' | 'checking' | 'pending' | 'not_found' | 'error';

export type PaymentState =
  | { status: 'idle' }
  | { status: 'requesting'; attempt: number; idempotencyKey: string }
  | {
      status: 'awaiting_customer';
      attempt: number;
      idempotencyKey: string;
      checkoutRequestId: string;
      startedAt: number;
      deadline: number;
      polls: number;
      offline: boolean;
      reused: boolean;
    }
  | { status: 'paid'; receipt: string; paidAt: number }
  | { status: 'failed'; reason: FailReason; attempt: number; detail?: string }
  | { status: 'expired'; attempt: number; checkoutRequestId: string; check: ExpiredCheck };

export type PaymentEvent =
  | { type: 'submit'; attempt: number; idempotencyKey: string }
  | { type: 'accepted'; checkoutRequestId: string; now: number; windowMs: number; reused?: boolean }
  | { type: 'already_paid'; receipt: string; paidAt: number }
  | { type: 'request_failed'; detail?: string }
  | { type: 'status'; result: StatusResult }
  | { type: 'poll_failed' }
  | { type: 'deadline'; now: number }
  | { type: 'connectivity'; online: boolean }
  | { type: 'cancel' }
  | { type: 'lookup_started' }
  | { type: 'lookup_result'; result: LookupResult }
  | { type: 'lookup_failed' }
  | { type: 'reset' }
  | {
      type: 'resume';
      attempt: number;
      idempotencyKey: string;
      checkoutRequestId: string;
      startedAt: number;
      now: number;
      windowMs: number;
    };

export const initialPayment: PaymentState = { status: 'idle' };

/** True when a new STK push may be started from this state. */
export function canSubmit(s: PaymentState): boolean {
  return s.status === 'idle' || s.status === 'failed' || (s.status === 'expired' && s.check === 'not_found');
}

export function isBusy(s: PaymentState): boolean {
  return s.status === 'requesting' || s.status === 'awaiting_customer';
}

export function paymentReducer(s: PaymentState, e: PaymentEvent): PaymentState {
  switch (e.type) {
    case 'submit':
      return canSubmit(s) ? { status: 'requesting', attempt: e.attempt, idempotencyKey: e.idempotencyKey } : s;

    case 'accepted':
      if (s.status !== 'requesting') return s;
      return {
        status: 'awaiting_customer',
        attempt: s.attempt,
        idempotencyKey: s.idempotencyKey,
        checkoutRequestId: e.checkoutRequestId,
        startedAt: e.now,
        deadline: e.now + e.windowMs,
        polls: 0,
        offline: false,
        reused: e.reused ?? false,
      };

    case 'already_paid':
      return s.status === 'requesting' ? { status: 'paid', receipt: e.receipt, paidAt: e.paidAt } : s;

    case 'request_failed':
      return s.status === 'requesting'
        ? { status: 'failed', reason: 'unreachable', attempt: s.attempt, ...(e.detail ? { detail: e.detail } : {}) }
        : s;

    case 'status': {
      if (s.status !== 'awaiting_customer') return s;
      const r = e.result;
      if (r.state === 'success') return { status: 'paid', receipt: r.receipt, paidAt: r.paidAt };
      if (r.state === 'failed') return { status: 'failed', reason: r.reason, attempt: s.attempt };
      return { ...s, polls: s.polls + 1 };
    }

    case 'poll_failed':
      return s.status === 'awaiting_customer' ? { ...s, polls: s.polls + 1 } : s;

    case 'deadline':
      if (s.status !== 'awaiting_customer' || e.now < s.deadline) return s;
      return { status: 'expired', attempt: s.attempt, checkoutRequestId: s.checkoutRequestId, check: 'none' };

    case 'connectivity':
      if (s.status !== 'awaiting_customer' || s.offline === !e.online) return s;
      return { ...s, offline: !e.online };

    case 'cancel':
      return s.status === 'awaiting_customer' ? { status: 'failed', reason: 'cancelled', attempt: s.attempt } : s;

    case 'lookup_started':
      return s.status === 'expired' && s.check !== 'checking' ? { ...s, check: 'checking' } : s;

    case 'lookup_result': {
      if (s.status !== 'expired') return s;
      const r = e.result;
      if (r.state === 'paid') return { status: 'paid', receipt: r.receipt, paidAt: r.paidAt };
      if (r.state === 'failed') return { status: 'failed', reason: r.reason, attempt: s.attempt };
      return { ...s, check: r.state === 'pending' ? 'pending' : 'not_found' };
    }

    case 'lookup_failed':
      return s.status === 'expired' ? { ...s, check: 'error' } : s;

    case 'reset':
      return s.status === 'failed' || (s.status === 'expired' && s.check === 'not_found') ? initialPayment : s;

    case 'resume': {
      if (s.status !== 'idle') return s;
      const deadline = e.startedAt + e.windowMs;
      if (e.now >= deadline) {
        return { status: 'expired', attempt: e.attempt, checkoutRequestId: e.checkoutRequestId, check: 'none' };
      }
      return {
        status: 'awaiting_customer',
        attempt: e.attempt,
        idempotencyKey: e.idempotencyKey,
        checkoutRequestId: e.checkoutRequestId,
        startedAt: e.startedAt,
        deadline,
        polls: 0,
        offline: false,
        reused: true,
      };
    }
  }
}
