import type { FailReason } from '../payment/types';

/**
 * What to tell the shopper when the live gateway's payment ends in each way.
 * Plain words, and honest about what is real (the gateway, its ledger) and
 * what is simulated (the Daraja side, in mock mode).
 */
export const GATEWAY_FAIL_COPY: Record<FailReason, { title: string; body: string }> = {
  cancelled: {
    title: 'Payment cancelled',
    body: 'The mock customer dismissed the prompt (result code 1032), so nothing was charged. You can send a new request when you are ready.',
  },
  wrong_pin: {
    title: 'M-Pesa did not accept the PIN',
    body: 'The mock Daraja reported a wrong PIN (result code 2001), so nothing was charged. Try again with the right PIN.',
  },
  insufficient_funds: {
    title: 'Not enough M-Pesa balance',
    body: 'The mock Daraja reported insufficient funds (result code 1), so nothing was charged. Try again, or choose pay on delivery.',
  },
  timeout: {
    title: 'The request timed out',
    body: 'No result arrived before the deadline, so the gateway marked this payment timed out and nothing was charged. If a late confirmation does arrive, the gateway holds it for review instead of marking it paid, so look at your order before you pay again.',
  },
  declined: {
    title: 'M-Pesa declined the payment',
    body: 'Daraja reported a failure, so nothing was charged.',
  },
  unreachable: {
    title: 'We could not reach the payment gateway',
    body: 'The request did not go through, so no payment was created and nothing was charged. Check your connection and try again, or use the in-browser simulator or pay on delivery.',
  },
  rate_limited: {
    title: 'The gateway is rate limiting this demo',
    body: 'Too many payments were started from this connection or this number in a short time. Nothing was charged. Wait for the countdown and try again, or use the in-browser simulator or pay on delivery.',
  },
  over_cap: {
    title: 'Over the demo payment limit',
    body: 'The public demo key on the live gateway only accepts payments up to a small cap. Use the in-browser simulator or pay on delivery for this order. Nothing was charged.',
  },
  rejected: {
    title: 'The gateway rejected the request',
    body: 'The gateway did not accept the details sent, so no payment was created and nothing was charged.',
  },
};

/** Gateway flags -> a sentence a shopper can follow. */
export const FLAG_COPY: Record<string, string> = {
  late_success: 'A success result arrived after the payment had already timed out.',
  callback_query_mismatch: 'The success callback and the follow-up status check disagreed.',
  callback_field_mismatch: 'The success callback did not match what we asked for.',
  unverified_success: 'A success result could not be verified.',
  push_outcome_unknown: 'We never learned whether the prompt was sent.',
  no_result_before_deadline: 'No result arrived before the deadline.',
};

export function describeFlags(flags: string[]): string[] {
  return flags.map((f) => FLAG_COPY[f]).filter((s): s is string => !!s);
}
