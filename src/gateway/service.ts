import {
  PaymentServiceError,
  type InitiateRequest,
  type InitiateResult,
  type LookupQuery,
  type LookupResult,
  type PaymentService,
  type PollSchedule,
  type ResultFailReason,
  type StatusResult,
} from '../payment/types';
import { createGatewayClient, GatewayError, type GatewayClient, type GatewayPayment } from './client';
import { DEMO_CAP_KES } from './config';

/** Gateway payment ids look like pay_<hex>. The simulator's request ids never start with this. */
export const isGatewayId = (id: string): boolean => id.startsWith('pay_');

/**
 * The gateway marks a prompt timed out after 90 s and cron settles it a little later. The wait
 * window has to outlast that, or we would stop looking just before the answer arrives.
 */
export const GATEWAY_WINDOW_MS = 150_000;
/** About 1.5 s at first, then easing off. The last value repeats. */
export const GATEWAY_BACKOFF_MS = [1_500, 1_500, 2_000, 3_000, 4_000, 5_000];
/** After a timeout we keep watching this long: a late success moves it to needs_review. */
export const LATE_WATCH_MS = 30_000;

const ms = (iso: string) => Date.parse(iso);

/** Why a failed payment failed, from Daraja's result code (the codes the gateway documents). */
export function failReason(p: Pick<GatewayPayment, 'status' | 'result_code'>): ResultFailReason {
  if (p.status === 'cancelled') return 'cancelled';
  if (p.status === 'timed_out') return 'timeout';
  switch (p.result_code) {
    case 2001:
      return 'wrong_pin';
    case 1:
      return 'insufficient_funds';
    case 1032:
      return 'cancelled';
    case 1037:
      return 'timeout';
    default:
      return 'declined';
  }
}

/**
 * Gateway payment -> what the checkout shows. Never reports `success` unless the gateway
 * says `succeeded`; `needs_review` is its own answer, not a kind of success.
 */
export function toStatusResult(p: GatewayPayment): StatusResult {
  switch (p.status) {
    case 'pending':
      return { state: 'pending' };
    case 'succeeded':
      return {
        state: 'success',
        receipt: p.mpesa_receipt ?? p.id,
        paidAt: ms(p.updated_at),
        resultCode: p.result_code ?? 0,
      };
    case 'needs_review':
      return { state: 'review', flags: p.flags, ...(p.result_desc ? { resultDesc: p.result_desc } : {}) };
    case 'failed':
    case 'cancelled':
    case 'timed_out':
      return {
        state: 'failed',
        reason: failReason(p),
        resultCode: p.result_code ?? 0,
        resultDesc: p.result_desc ?? '',
      };
  }
}

/** Every payment the gateway holds for one order reference, newest first -> the order's answer. */
export function toLookupResult(items: GatewayPayment[], amount?: number): LookupResult {
  const mine = amount === undefined ? items : items.filter((p) => p.amount === amount);
  if (mine.length === 0) return { state: 'not_found' };
  const paid = mine.find((p) => p.status === 'succeeded');
  if (paid) return { state: 'paid', receipt: paid.mpesa_receipt ?? paid.id, paidAt: ms(paid.updated_at), amount: paid.amount };
  const latest = mine[0]!;
  if (latest.status === 'pending') return { state: 'pending' };
  if (latest.status === 'needs_review') return { state: 'review', flags: latest.flags };
  return { state: 'failed', reason: failReason(latest), ...(latest.result_desc ? { detail: latest.result_desc } : {}) };
}

function fail(err: unknown): PaymentServiceError {
  if (err instanceof PaymentServiceError) return err;
  if (err instanceof GatewayError) {
    switch (err.kind) {
      case 'rate_limited':
        return new PaymentServiceError('rate_limited', err.message, { retryAfterSec: err.retryAfterSec ?? 30 });
      case 'over_cap':
        return new PaymentServiceError('over_cap', err.message);
      case 'validation':
      case 'idempotency_conflict':
      case 'reference_pending':
        return new PaymentServiceError('rejected', err.field ? `${err.message} (${err.field})` : err.message);
      case 'not_found':
        return new PaymentServiceError('not_found', err.message);
      default:
        return new PaymentServiceError('unreachable', err.message);
    }
  }
  return new PaymentServiceError('unreachable', err instanceof Error ? err.message : 'Could not reach the payment gateway.');
}

export interface GatewayService extends PaymentService {
  client: GatewayClient;
}

export function createGatewayService(
  opts: { client?: GatewayClient; now?: () => number; capKes?: number } = {},
): GatewayService {
  const client = opts.client ?? createGatewayClient();
  const now = opts.now ?? (() => Date.now());
  const cap = opts.capKes ?? DEMO_CAP_KES;
  /** when we first saw each payment as timed_out (client clock), for the late-result watch */
  const timedOutSeen = new Map<string, number>();

  const accepted = (p: GatewayPayment, replayed: boolean): InitiateResult => {
    const t = now();
    const window = replayed ? Math.max(0, ms(p.expires_at) - t) : ms(p.expires_at) - ms(p.created_at);
    return {
      kind: 'accepted',
      checkoutRequestId: p.id,
      expiresAt: t + window,
      reused: replayed,
      ...(p.checkout_request_id ? { darajaCheckoutId: p.checkout_request_id } : {}),
      windowMs: GATEWAY_WINDOW_MS,
      promptEndsAt: t + window,
    };
  };

  return {
    client,

    async initiateStkPush(req: InitiateRequest): Promise<InitiateResult> {
      if (req.amount > cap) {
        throw new PaymentServiceError('over_cap', `The demo gateway key accepts payments up to KES ${cap.toLocaleString('en-KE')}.`);
      }
      try {
        const { payment, replayed } = await client.createPayment(
          {
            amount: req.amount,
            phone: req.msisdn,
            reference: req.orderRef,
            ...(req.description ? { description: req.description } : {}),
            ...(req.scenario ? { scenario: req.scenario } : {}),
          },
          req.idempotencyKey,
        );
        if (payment.status === 'succeeded') {
          return { kind: 'already_paid', receipt: payment.mpesa_receipt ?? payment.id, paidAt: ms(payment.updated_at) };
        }
        return accepted(payment, replayed);
      } catch (err) {
        // A payment for this order is already in flight (another tab, a retry): follow it, do not stack a second.
        if (err instanceof GatewayError && err.kind === 'reference_pending') {
          try {
            const live = (await client.listByReference(req.orderRef)).find((p) => p.status === 'pending');
            if (live) return accepted(live, true);
          } catch {
            /* fall through to the original error */
          }
        }
        throw fail(err);
      }
    },

    async queryStatus(id: string): Promise<StatusResult> {
      let p: GatewayPayment;
      try {
        p = await client.getPayment(id);
      } catch (err) {
        throw fail(err);
      }
      if (p.status === 'timed_out') {
        const first = timedOutSeen.get(id) ?? now();
        timedOutSeen.set(id, first);
        if (now() - first < LATE_WATCH_MS) return { state: 'pending', phase: 'late_watch' };
      }
      return toStatusResult(p);
    },

    // The gateway has no cancel endpoint: a pending payment keeps going until it settles or times out.
    async cancel(): Promise<void> {},

    async lookupPayment(q: LookupQuery): Promise<LookupResult> {
      try {
        return toLookupResult(await client.listByReference(q.orderRef), q.amount);
      } catch (err) {
        throw fail(err);
      }
    },

    pollSchedule(id: string): PollSchedule | undefined {
      return isGatewayId(id) ? { backoffMs: GATEWAY_BACKOFF_MS, windowMs: GATEWAY_WINDOW_MS } : undefined;
    },
  };
}
