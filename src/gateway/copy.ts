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
  phone_not_approved: {
    title: 'This number is not approved',
    body: 'The gateway only accepts approved phone numbers, and this one is not on its list, so no payment was created.',
  },
};

/**
 * The same endings for the Safaricom sandbox, where the Daraja side is real. It never says "mock", and it
 * does not promise more than we have seen: a cancelled prompt (1032) and a prompt nobody answered (1037)
 * are real results we have observed, as is one completed KES 1 payment (a small sample).
 */
export const SANDBOX_FAIL_COPY: Record<FailReason, { title: string; body: string }> = {
  cancelled: {
    title: 'Prompt cancelled',
    body: 'Safaricom reported that the prompt was cancelled on the phone (result code 1032), so this payment did not go through. You can send a new prompt when you are ready.',
  },
  timeout: {
    title: 'No response in time',
    body: 'Safaricom reported no response to the prompt (result code 1037), so this payment did not go through. Keep your phone nearby and send a new prompt if you want to try again.',
  },
  wrong_pin: {
    title: 'M-Pesa did not accept the PIN',
    body: 'Safaricom reported that the PIN was not accepted, so this payment did not go through. Be careful: several wrong PINs in a row can lock M-Pesa on your SIM.',
  },
  insufficient_funds: {
    title: 'Not enough M-Pesa balance',
    body: 'Safaricom reported that the balance was too low for the KES 1 test charge, so this payment did not go through.',
  },
  declined: {
    title: 'The payment failed',
    body: 'Safaricom reported a failure, so this payment did not go through.',
  },
  unreachable: {
    title: 'We could not reach the Safaricom sandbox gateway',
    body: 'The request did not go through, so no payment was created and no prompt was sent. Check your connection and try again, or use the mock gateway, the in-browser simulator or pay on delivery.',
  },
  rate_limited: {
    title: 'The sandbox gateway is rate limiting this demo',
    body: 'Too many payments were started from this connection or this number in a short time, so no prompt was sent. Wait for the countdown and try again, or use the mock gateway, the in-browser simulator or pay on delivery.',
  },
  over_cap: {
    title: 'Over the sandbox payment limit',
    body: 'The sandbox gateway refused the test charge as over its limit for the public demo key, so no prompt was sent. Use the mock gateway, the in-browser simulator or pay on delivery.',
  },
  rejected: {
    title: 'The gateway rejected the request',
    body: 'The sandbox gateway did not accept the details sent, so no payment was created and no prompt was sent.',
  },
  phone_not_approved: {
    title: 'This sandbox only accepts approved numbers',
    body: 'The Safaricom sandbox on this site is restricted to phone numbers its owner has approved, and the number you entered is not one of them, so no prompt was sent. The mock gateway accepts any number and never sends a real prompt: use that instead.',
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
