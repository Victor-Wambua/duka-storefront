import { formatKES } from '../lib/money';

/**
 * The Safaricom sandbox provider: what is true of it, in one place.
 *
 * The sandbox gateway talks to Safaricom's real Daraja sandbox and has sent a real STK prompt to
 * the owner's own phone. Real outcomes seen so far: ResultCode 1032 (cancelled by the customer,
 * callback after about 8 s) and 1037 (no response, callback after about 26 s). The owner has
 * completed TWO payments with a PIN (KES 1 each, on their own numbers, 2026-11-28). The first went
 * through the gateway directly: the success callback (ResultCode 0, a real receipt) came 9 s after
 * the push, the gateway's STK Query confirmed it on the second try, and the gateway then marked it
 * succeeded with a balanced journal. The second was this storefront's sandbox option: a first attempt
 * was cancelled, a retry succeeded, and the gateway's status query confirmed the receipt. Two
 * payments are still a small sample. Whether a sandbox success debits a real wallet has NOT been
 * checked by this project.
 */

/** The sandbox key caps a payment at KES 100 and the shop's carts are larger, so every sandbox payment is this flat amount. */
export const SANDBOX_CHARGE_KES = 1;

/** The gateway times a sandbox prompt out after 150 s and settles it a little later. */
export const SANDBOX_PROMPT_SEC = 150;
export const SANDBOX_WINDOW_MS = 210_000;
/** Poll a little more gently than the mock gateway: a real prompt takes a person tens of seconds. The last value repeats. */
export const SANDBOX_BACKOFF_MS = [2_000, 2_000, 3_000, 4_000, 5_000];

/** Sandbox payment ids look like the mock's (pay_...), so the app tags its own copy to route a later poll to the right host. */
export const SANDBOX_ID_PREFIX = 'sbx:';

export const SANDBOX_LABEL = 'Safaricom sandbox (real prompt on your phone)';

export const SANDBOX_WARNING =
  'This sends a real prompt to the phone number you enter. Use only your own number. Two KES 1 payments have been completed with a PIN here, which is a small sample, and we have not checked whether approving a sandbox prompt debits a real wallet. Safaricom sandbox, KES 1 test charge.';

export const SANDBOX_PENDING_COPY =
  'Check your phone for an M-Pesa prompt and enter your PIN to approve it, or cancel it. This can take up to 2.5 minutes.';

/** What the sandbox is asked to charge for an order of this size. Never the order total. */
export function sandboxChargeFor(orderTotal: number): number {
  void orderTotal;
  return SANDBOX_CHARGE_KES;
}

/** 'Sandbox test charge: KES 1 stands in for the KES 620 order' */
export function standInNote(orderTotal: number): string {
  return `Sandbox test charge: ${formatKES(sandboxChargeFor(orderTotal))} stands in for the ${formatKES(orderTotal)} order`;
}
