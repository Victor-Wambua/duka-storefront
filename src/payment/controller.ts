import { initialPayment, isBusy, paymentReducer, type PaymentEvent, type PaymentState } from './machine';
import { PaymentServiceError, type LookupQuery, type PaymentService, type ProviderId } from './types';

export const DEFAULT_WINDOW_MS = 75_000;
/** wait before poll 1, 2, 3...; the last value repeats */
export const DEFAULT_BACKOFF_MS = [2_000, 3_000, 4_500, 6_000, 8_000];

export interface ControllerOptions {
  service: PaymentService;
  windowMs?: number | (() => number);
  backoffMs?: number[];
  now?: () => number;
  /** called when a request id is issued, so the caller can persist it for reload recovery */
  onAttempt?: (info: { attempt: number; checkoutRequestId: string; darajaCheckoutId?: string }) => void;
  onChange?: (s: PaymentState) => void;
}

export interface PayParams {
  orderRef: string;
  attempt: number;
  msisdn: string;
  amount: number;
  provider?: ProviderId;
  scenario?: string;
  description?: string;
  /** supply one to keep a double click or a reload from creating a second payment; defaults to `orderRef:attempt` */
  idempotencyKey?: string;
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
  private visible = true;
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
    this.now = opts.now ?? (() => Date.now());
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
    const idempotencyKey = p.idempotencyKey ?? `${p.orderRef}:${p.attempt}`;
    this.dispatch({ type: 'submit', attempt: p.attempt, idempotencyKey });
    if (this.state.status !== 'requesting') return false;
    this.submitting = true;
    try {
      const res = await this.service.initiateStkPush({
        orderRef: p.orderRef,
        idempotencyKey,
        msisdn: p.msisdn,
        amount: p.amount,
        ...(p.provider ? { provider: p.provider } : {}),
        ...(p.scenario ? { scenario: p.scenario } : {}),
        ...(p.description ? { description: p.description } : {}),
      });
      if (this.disposed) return true;
      if (res.kind === 'already_paid') {
        this.dispatch({ type: 'already_paid', receipt: res.receipt, paidAt: res.paidAt });
      } else {
        this.dispatch({
          type: 'accepted',
          checkoutRequestId: res.checkoutRequestId,
          now: this.now(),
          windowMs: res.windowMs ?? this.windowFn(),
          reused: res.reused,
          ...(res.promptEndsAt !== undefined ? { promptEndsAt: res.promptEndsAt } : {}),
        });
        this.opts.onAttempt?.({
          attempt: p.attempt,
          checkoutRequestId: res.checkoutRequestId,
          ...(res.darajaCheckoutId ? { darajaCheckoutId: res.darajaCheckoutId } : {}),
        });
        this.startWaiting();
      }
    } catch (err) {
      if (!this.disposed) {
        const code = err instanceof PaymentServiceError ? err.code : null;
        this.dispatch({
          type: 'request_failed',
          ...(err instanceof Error ? { detail: err.message } : {}),
          ...(code === 'rate_limited' || code === 'over_cap' || code === 'rejected' ? { reason: code } : {}),
          ...(err instanceof PaymentServiceError && err.retryAfterSec !== undefined ? { retryAfterSec: err.retryAfterSec } : {}),
        });
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
      windowMs: this.service.pollSchedule?.(p.checkoutRequestId)?.windowMs ?? this.windowFn(),
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
    const steps = this.service.pollSchedule?.(s.checkoutRequestId)?.backoffMs ?? this.backoff;
    const wait = delay ?? steps[Math.min(s.polls, steps.length - 1)] ?? 5_000;
    this.pollTimer = setTimeout(() => void this.poll(), wait);
  }

  private waitingOn(id: string): boolean {
    return !this.disposed && this.state.status === 'awaiting_customer' && this.state.checkoutRequestId === id;
  }

  private async poll(): Promise<void> {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    if (!this.online || !this.visible) return; // setOnline(true) / setVisible(true) poll immediately
    const id = s.checkoutRequestId;
    let retryAfterMs = 0;
    try {
      const result = await this.service.queryStatus(id);
      if (!this.waitingOn(id)) return; // a newer attempt or a final state took over
      this.dispatch({ type: 'status', result });
    } catch (err) {
      if (!this.waitingOn(id)) return;
      if (err instanceof PaymentServiceError && err.retryAfterSec !== undefined) retryAfterMs = err.retryAfterSec * 1000;
      this.dispatch({ type: 'poll_failed' });
    }
    if (this.waitingOn(id)) {
      this.schedulePoll();
      // Rate limited: never come back sooner than the server asked.
      if (retryAfterMs > 0 && this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => void this.poll(), retryAfterMs);
      }
    }
  }

  private async onDeadline(): Promise<void> {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    const id = s.checkoutRequestId;
    // One last look before giving up on this request.
    if (this.online && this.visible) {
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

  /** Poll nothing while the page is hidden; catch up as soon as it is shown again. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible && this.state.status === 'awaiting_customer' && this.online) this.schedulePoll(0);
  }

  /** "Stop waiting": the customer (or the shopper) gave up on this prompt. */
  cancel(): void {
    const s = this.state;
    if (s.status !== 'awaiting_customer') return;
    this.dispatch({ type: 'cancel' });
    void this.service.cancel(s.checkoutRequestId).catch(() => undefined);
  }

  /** From `expired` or `review`: ask the backend what actually happened. */
  async checkStatus(q: LookupQuery): Promise<void> {
    const st = this.state;
    if ((st.status !== 'expired' && st.status !== 'review') || st.check === 'checking') return;
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
