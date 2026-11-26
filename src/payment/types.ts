/**
 * The contract between the storefront and "the payment backend".
 * `src/mock/mpesaMock.ts` implements it in the browser. A real implementation
 * would call your own server, which talks to Safaricom's Daraja API
 * (see docs/CASE-STUDY.md for the mapping).
 */

export type FailReason = 'cancelled' | 'wrong_pin' | 'insufficient_funds' | 'timeout' | 'unreachable';

export interface InitiateRequest {
  orderRef: string;
  /** one per STK push attempt; replays return the same checkout request */
  idempotencyKey: string;
  /** 2547XXXXXXXX */
  msisdn: string;
  /** whole shillings */
  amount: number;
}

export type InitiateResult =
  | {
      kind: 'accepted';
      checkoutRequestId: string;
      expiresAt: number;
      /** true when an existing in-flight request for this order was returned instead of a new one */
      reused: boolean;
    }
  | { kind: 'already_paid'; receipt: string; paidAt: number };

export type StatusResult =
  | { state: 'pending' }
  | { state: 'success'; receipt: string; paidAt: number; resultCode: number }
  | { state: 'failed'; reason: Exclude<FailReason, 'unreachable'>; resultCode: number; resultDesc: string };

export type LookupResult =
  | { state: 'paid'; receipt: string; paidAt: number; amount: number }
  | { state: 'pending' }
  | { state: 'failed'; reason: Exclude<FailReason, 'unreachable'> }
  | { state: 'not_found' };

export class PaymentServiceError extends Error {
  readonly code: 'unreachable' | 'invalid_request' | 'not_found';
  constructor(code: PaymentServiceError['code'], message: string) {
    super(message);
    this.name = 'PaymentServiceError';
    this.code = code;
  }
}

export interface PaymentService {
  initiateStkPush(req: InitiateRequest): Promise<InitiateResult>;
  queryStatus(checkoutRequestId: string): Promise<StatusResult>;
  /** Stop waiting on a request; the mock marks it abandoned. */
  cancel(checkoutRequestId: string): Promise<void>;
  /** Look a payment up by order reference + phone (the "I've paid but it's pending" path). */
  lookupPayment(q: { orderRef: string; msisdn: string }): Promise<LookupResult>;
}
