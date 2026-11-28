/**
 * The contract between the storefront and "the payment backend".
 * Two implementations sit behind it: `src/mock/mpesaMock.ts` runs in the
 * browser (the offline fallback) and `src/gateway/service.ts` talks to the live
 * payments gateway, which in turn talks to Daraja (a mock Daraja for now).
 */

/** Which backend created or owns a payment. */
export type ProviderId = 'gateway' | 'simulator';

/** Endings that come from the payment itself (the backend answered). */
export type ResultFailReason = 'cancelled' | 'wrong_pin' | 'insufficient_funds' | 'timeout' | 'declined';

/** `declined` is any other Daraja failure code, shown with its own description. The rest never reached a payment. */
export type FailReason = ResultFailReason | 'unreachable' | 'rate_limited' | 'over_cap' | 'rejected';

export interface InitiateRequest {
  orderRef: string;
  /** one per STK push attempt; replays return the same checkout request */
  idempotencyKey: string;
  /** 2547XXXXXXXX */
  msisdn: string;
  /** whole shillings */
  amount: number;
  /** which backend to use; defaults to the app's current choice */
  provider?: ProviderId;
  /** gateway mock mode only: how the pretend handset should behave */
  scenario?: string;
  description?: string;
}

export type InitiateResult =
  | {
      kind: 'accepted';
      checkoutRequestId: string;
      expiresAt: number;
      /** true when an existing in-flight request for this order was returned instead of a new one */
      reused: boolean;
      /** the backend's own id for the prompt (Daraja's CheckoutRequestID), when it has one */
      darajaCheckoutId?: string;
      /** how long this backend may need to settle; overrides the controller's default wait window */
      windowMs?: number;
      /** when the prompt itself stops being answerable (shown as the countdown) */
      promptEndsAt?: number;
    }
  | { kind: 'already_paid'; receipt: string; paidAt: number };

export type StatusResult =
  /** `late_watch`: the prompt window closed with no answer; we keep watching in case a late result arrives */
  | { state: 'pending'; phase?: 'late_watch' }
  | { state: 'success'; receipt: string; paidAt: number; resultCode: number }
  | { state: 'failed'; reason: ResultFailReason; resultCode: number; resultDesc: string }
  /** the backend is not sure and will not say paid: a late or conflicting result is being checked */
  | { state: 'review'; flags: string[]; resultDesc?: string };

export type LookupResult =
  | { state: 'paid'; receipt: string; paidAt: number; amount: number }
  | { state: 'pending' }
  | { state: 'failed'; reason: ResultFailReason; detail?: string }
  | { state: 'review'; flags: string[] }
  | { state: 'not_found' };

export interface LookupQuery {
  orderRef: string;
  msisdn: string;
  provider?: ProviderId;
  /** the order total: a payment for a different amount never counts as this order's payment */
  amount?: number;
}

export class PaymentServiceError extends Error {
  readonly code: 'unreachable' | 'invalid_request' | 'not_found' | 'rate_limited' | 'over_cap' | 'rejected';
  /** rate_limited: seconds to wait, from the Retry-After header */
  readonly retryAfterSec?: number;
  constructor(code: PaymentServiceError['code'], message: string, opts: { retryAfterSec?: number } = {}) {
    super(message);
    this.name = 'PaymentServiceError';
    this.code = code;
    if (opts.retryAfterSec !== undefined) this.retryAfterSec = opts.retryAfterSec;
  }
}

/** How a backend wants to be polled and how long it may need to settle. */
export interface PollSchedule {
  backoffMs: number[];
  windowMs: number;
}

export interface PaymentService {
  initiateStkPush(req: InitiateRequest): Promise<InitiateResult>;
  queryStatus(checkoutRequestId: string): Promise<StatusResult>;
  /** Stop waiting on a request; the mock marks it abandoned. */
  cancel(checkoutRequestId: string): Promise<void>;
  /** Look a payment up by order reference + phone (the "I've paid but it's pending" path). */
  lookupPayment(q: LookupQuery): Promise<LookupResult>;
  /** Optional: per-request polling schedule (the live gateway polls faster than the simulator). */
  pollSchedule?(requestId: string): PollSchedule | undefined;
}
