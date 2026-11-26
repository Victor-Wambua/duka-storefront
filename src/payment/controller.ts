import { initialPayment, isBusy, paymentReducer, type PaymentEvent, type PaymentState } from './machine';
import type { PaymentService } from './types';

export const DEFAULT_WINDOW_MS = 75_000;
/** wait before poll 1, 2, 3...; the last value repeats */
export const DEFAULT_BACKOFF_MS = [2_000, 3_000, 4_500, 6_000, 8_000];

export interface ControllerOptions {
  service: PaymentService;
  windowMs?: number | (() => number);
  backoffMs?: number[];
  now?: () => number;
  /** called when a request id is issued, so the caller can persist it for reload recovery */
  onAttempt?: (info: { attempt: number; checkoutRequestId: string }) => void;
  onChange?: (s: PaymentState) => void;
}

export interface PayParams {
  orderRef: string;
  attempt: number;
  msisdn: string;
  amount: number;
}

/**
 * Drives the payment state machine: sends the push, polls with backoff,
 * enforces the wait window, pauses while offline, and never lets two pushes
 * be in flight at once.
 */
export class PaymentController {
  private state: PaymentState = initialPayment;
  private readonly listeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private submitting = false;
  private online = true;
  private disposed = false;
  private readonly service: PaymentService;
  private readonly windowFn: () => number;
  private readonly backoff: number[];
  private readonly now: () => number;
  private readonly opts: ControllerOptions;

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    this.service = opts.service;
    const w = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.windowFn = typeof w === 'function' ? w : () => w;
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.now = opts.now ?? Date.now;
  }

  getState = (): PaymentState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private dispatch(e: PaymentEvent): void {
    const next = paymentReducer(this.state, e);
    if (next === this.state) return;
    this.state = next;
    if (!isBusy(next)) this.clearTimers();
    this.opts.onChange?.(next);
    this.listeners.forEach((l) => l());
  }

  private clearTimers(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.pollTimer = this.deadlineTimer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
  }

  /** Start a payment attempt. Returns false if one is already running (double-submit). */
  async pay(p: PayParams): Promise<boolean> {
    if (this.submitting || isBusy(this.state)) return false;
    const idempotencyKey = `${p.orderRef}:${p.attempt}`;
    this.dispatch({ type: 'submit', attempt: p.attempt, idempotencyKey });
    if (this.state.status !== 'requesting') return false;
    this.submitting = true;
    try {
      const res = await this.service.initiateStkPush({
        orderRef: p.orderRef,
        idempotencyKey,
        msisdn: p.msisdn,
        amount: p.amount,
      });
      if (this.disposed) return true;
      if (res.kind === 'already_paid') {
        this.dispatch({ type: 'already_paid', receipt: res.receipt, paidAt: res.paidAt });
      } else {
        this.dispatch({
          type: 'accepted',
          checkoutRequestId: res.checkoutRequestId,
          now: this.now(),
          windowMs: this.windowFn(),
          reused: res.reused,
        });
        this.opts.onAttempt?.({ attempt: p.attempt, checkoutRequestId: res.checkoutRequestId });
        this.startWaiting();
      }
    } catch (err) {
      if (!this.disposed) {
        this.dispatch({ type: 'request_failed', ...(err instanceof Error ? { detail: err.message } : {}) });
      }
    } finally {
      this.submitting = false;
    }
    return true;
  }

  /** Re-attach to a request that was already sent (page reload mid-payment). */
  resume(p: { attempt: number; orderRef: string; checkoutRequestId: string; startedAt: number }): void {
    this.dispatch({
      type: 'resume',
      attempt: p.attempt,
      idempotencyKey: `${p.orderRef}:${p.attempt}`,
      checkoutRequestId: p.checkoutRequestId,
      startedAt: p.startedAt,
      now: this.now(),
      windowMs: this.windowFn(),
    });
    if (this.state.status === 'awaiting_customer') this.startWaiting(0);
  }

  private startWaiting(firstDelay?: number): void {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    this.deadlineTimer = setTimeout(() => void this.onDeadline(), Math.max(0, s.deadline - this.now()));
    this.schedulePoll(firstDelay);
  }

  private schedulePoll(delay?: number): void {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const wait = delay ?? this.backoff[Math.min(s.polls, this.backoff.length - 1)] ?? 5_000;
    this.pollTimer = setTimeout(() => void this.poll(), wait);
  }

  private waitingOn(id: string): boolean {
    return !this.disposed && this.state.status === 'awaiting_customer' && this.state.checkoutRequestId === id;
  }

  private async poll(): Promise<void> {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    if (!this.online) return; // setOnline(true) polls immediately
    const id = s.checkoutRequestId;
    try {
      const result = await this.service.queryStatus(id);
      if (!this.waitingOn(id)) return; // a newer attempt or a final state took over
      this.dispatch({ type: 'status', result });
    } catch {
      if (!this.waitingOn(id)) return;
      this.dispatch({ type: 'poll_failed' });
    }
    if (this.waitingOn(id)) this.schedulePoll();
  }

  private async onDeadline(): Promise<void> {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    const id = s.checkoutRequestId;
    // One last look before giving up on this request.
    if (this.online) {
      try {
        const result = await this.service.queryStatus(id);
        if (!this.waitingOn(id)) return;
        this.dispatch({ type: 'status', result });
      } catch {
        /* fall through to expiry */
      }
    }
    if (this.waitingOn(id)) this.dispatch({ type: 'deadline', now: this.now() });
  }

  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    this.dispatch({ type: 'connectivity', online });
    if (online && this.state.status === 'awaiting_customer') {
      this.schedulePoll(0);
    }
  }

  /** "Stop waiting": the customer (or the shopper) gave up on this prompt. */
  cancel(): void {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    this.dispatch({ type: 'cancel' });
    void this.service.cancel(s.checkoutRequestId).catch(() => undefined);
  }

  /** From `expired`: ask the backend what actually happened. */
  async checkStatus(q: { orderRef: string; msisdn: string }): Promise<void> {
    if (this.state.status !== 'expired' || this.state.check === 'checking') return;
    this.dispatch({ type: 'lookup_started' });
    try {
      const result = await this.service.lookupPayment(q);
      if (!this.disposed) this.dispatch({ type: 'lookup_result', result });
    } catch {
      if (!this.disposed) this.dispatch({ type: 'lookup_failed' });
    }
  }

  /** Back to the form (failed, or expired with no payment found). */
  reset(): void {
    this.dispatch({ type: 'reset' });
  }
}
