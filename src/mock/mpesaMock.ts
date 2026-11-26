import { createStore, type Store } from '../lib/persist';
import {
  PaymentServiceError,
  type InitiateRequest,
  type InitiateResult,
  type LookupResult,
  type PaymentService,
  type StatusResult,
} from '../payment/types';

/**
 * In-browser stand-in for "our server + Safaricom Daraja".
 *
 * There are no timers here. A request records when it was created and what the
 * simulated handset will do; every query works out the answer from the current
 * time. That keeps it deterministic, lets state survive a page reload (it is
 * persisted in localStorage), and makes it trivial to drive with fake timers.
 */

export type SimOutcome =
  | 'success'
  | 'cancelled'
  | 'wrong_pin'
  | 'insufficient_funds'
  | 'timeout'
  | 'unreachable'
  | 'delayed_paid'
  | 'silent'
  | 'manual';

export interface SimSettings {
  outcome: SimOutcome;
  /** seconds until the simulated customer answers */
  delaySec: number;
  /** how long the storefront waits before giving up on a prompt */
  windowSec: number;
  /** simulated network latency per call */
  latencyMs: number;
}

export type Decision = 'success' | 'cancelled' | 'wrong_pin' | 'insufficient_funds' | 'timeout';

export interface MockRequest {
  id: string;
  merchantRequestId: string;
  orderRef: string;
  idempotencyKey: string;
  msisdn: string;
  amount: number;
  createdAt: number;
  /** when the simulated customer answers; null for manual mode */
  resolveAt: number | null;
  outcome: SimOutcome;
  decision?: Decision;
  abandoned?: boolean;
}

export interface MockPayment {
  orderRef: string;
  checkoutRequestId: string;
  msisdn: string;
  amount: number;
  receipt: string;
  paidAt: number;
}

export interface MockServerState {
  requests: Record<string, MockRequest>;
  payments: Record<string, MockPayment>;
}

/** How long a prompt stays alive on the handset (approximate; real behaviour varies). */
export const PROMPT_LIFETIME_MS = 60_000;
/** For `delayed_paid`: when the status query finally reports the payment. */
const QUERY_VISIBLE_AFTER_MS = 120_000;

export const DEFAULT_SIM: SimSettings = { outcome: 'success', delaySec: 4, windowSec: 75, latencyMs: 350 };

/** Result codes as documented for Daraja's STK callback (unverified against the live API). */
export const RESULT_CODES = {
  success: { code: 0, desc: 'The service request is processed successfully.' },
  insufficient_funds: { code: 1, desc: 'The balance is insufficient for the transaction.' },
  cancelled: { code: 1032, desc: 'Request cancelled by user.' },
  timeout: { code: 1037, desc: 'DS timeout: user cannot be reached.' },
  wrong_pin: { code: 2001, desc: 'The initiator information is invalid (wrong PIN).' },
} as const;

const SERVER_SPEC = (key: string) => ({
  key,
  version: 1,
  initial: (): MockServerState => ({ requests: {}, payments: {} }),
  validate: (d: unknown): MockServerState | null =>
    typeof d === 'object' && d !== null && 'requests' in d && 'payments' in d ? (d as MockServerState) : null,
});

const SIM_SPEC = (key: string) => ({
  key,
  version: 1,
  initial: (): SimSettings => ({ ...DEFAULT_SIM }),
  validate: (d: unknown): SimSettings | null =>
    typeof d === 'object' && d !== null && 'outcome' in d ? { ...DEFAULT_SIM, ...(d as SimSettings) } : null,
});

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Obviously simulated: "SIM" + 7 characters. Real M-Pesa receipts look different. */
export function simReceipt(seed: string): string {
  let h = hash(seed);
  let out = 'SIM';
  for (let i = 0; i < 7; i++) {
    out += ALNUM[h % ALNUM.length];
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0 || hash(seed + i);
  }
  return out;
}

type Evaluation =
  | { state: 'pending' }
  | { state: 'success' }
  | { state: 'failed'; reason: Exclude<Decision, 'success'> };

export interface MockMpesa extends PaymentService {
  server: Store<MockServerState>;
  sim: Store<SimSettings>;
  /** manual mode: what the person holding the phone did */
  handsetRespond(checkoutRequestId: string, decision: Decision): void;
  /** requests whose prompt is still on the simulated handset */
  livePrompts(): MockRequest[];
  reset(): void;
}

export function createMockMpesa(opts: { now?: () => number; serverKey?: string; simKey?: string } = {}): MockMpesa {
  const now = opts.now ?? (() => Date.now());
  const server = createStore<MockServerState>(SERVER_SPEC(opts.serverKey ?? 'duka.mock.server'));
  const sim = createStore<SimSettings>(SIM_SPEC(opts.simKey ?? 'duka.mock.sim'));

  const latency = async () => {
    const ms = sim.get().latencyMs;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  };

  /** What the handset has done so far, ignoring what the status API chooses to show. */
  function evaluate(r: MockRequest, t: number): Evaluation {
    if (r.abandoned) return { state: 'failed', reason: 'cancelled' };
    if (r.outcome === 'manual') {
      if (r.decision) return r.decision === 'success' ? { state: 'success' } : { state: 'failed', reason: r.decision };
      return t >= r.createdAt + PROMPT_LIFETIME_MS ? { state: 'failed', reason: 'timeout' } : { state: 'pending' };
    }
    if (r.resolveAt === null || t < r.resolveAt) return { state: 'pending' };
    switch (r.outcome) {
      case 'success':
      case 'delayed_paid':
        return { state: 'success' };
      case 'cancelled':
      case 'wrong_pin':
      case 'insufficient_funds':
      case 'timeout':
        return { state: 'failed', reason: r.outcome };
      default:
        return { state: 'pending' }; // silent, unreachable
    }
  }

  /** Record any payment that has landed by now (the "callback" arriving). */
  function settle(orderRef?: string): void {
    const t = now();
    const s = server.get();
    let payments = s.payments;
    for (const r of Object.values(s.requests)) {
      if (orderRef && r.orderRef !== orderRef) continue;
      if (payments[r.orderRef]) continue;
      if (evaluate(r, t).state === 'success') {
        payments = {
          ...payments,
          [r.orderRef]: {
            orderRef: r.orderRef,
            checkoutRequestId: r.id,
            msisdn: r.msisdn,
            amount: r.amount,
            receipt: simReceipt(r.id),
            paidAt: r.resolveAt ?? t,
          },
        };
      }
    }
    if (payments !== s.payments) server.set({ ...s, payments });
  }

  const isLive = (r: MockRequest, t: number) =>
    !r.abandoned && evaluate(r, t).state === 'pending' && t < r.createdAt + PROMPT_LIFETIME_MS;

  const service: MockMpesa = {
    server,
    sim,

    async initiateStkPush(req: InitiateRequest): Promise<InitiateResult> {
      await latency();
      const cfg = sim.get();
      if (cfg.outcome === 'unreachable') {
        throw new PaymentServiceError('unreachable', 'Could not reach the M-Pesa gateway.');
      }
      if (!Number.isSafeInteger(req.amount) || req.amount < 1) {
        throw new PaymentServiceError('invalid_request', 'Amount must be a whole number of shillings.');
      }
      if (!/^254[17]\d{8}$/.test(req.msisdn)) {
        throw new PaymentServiceError('invalid_request', 'Phone number is not a valid Kenyan mobile number.');
      }
      const t = now();
      settle(req.orderRef);
      const s = server.get();

      const paid = s.payments[req.orderRef];
      if (paid) return { kind: 'already_paid', receipt: paid.receipt, paidAt: paid.paidAt };

      const requests = Object.values(s.requests).filter((r) => r.orderRef === req.orderRef);
      // 1. Same idempotency key: a replay, return what we already created.
      const replay = requests.find((r) => r.idempotencyKey === req.idempotencyKey);
      if (replay) {
        return { kind: 'accepted', checkoutRequestId: replay.id, expiresAt: replay.createdAt + PROMPT_LIFETIME_MS, reused: true };
      }
      // 2. A prompt for this order is still on the handset: do not stack another one.
      const live = requests.find((r) => isLive(r, t));
      if (live) {
        return { kind: 'accepted', checkoutRequestId: live.id, expiresAt: live.createdAt + PROMPT_LIFETIME_MS, reused: true };
      }
      if (requests.some((r) => r.amount !== req.amount)) {
        throw new PaymentServiceError('invalid_request', 'Amount does not match the order.');
      }

      const n = Object.keys(s.requests).length + 1;
      const id = `ws_CO_SIM_${hash(`${req.idempotencyKey}:${n}`).toString(36).toUpperCase()}`;
      const request: MockRequest = {
        id,
        merchantRequestId: `SIM-MR-${n}`,
        orderRef: req.orderRef,
        idempotencyKey: req.idempotencyKey,
        msisdn: req.msisdn,
        amount: req.amount,
        createdAt: t,
        resolveAt: cfg.outcome === 'manual' ? null : t + cfg.delaySec * 1000,
        outcome: cfg.outcome,
      };
      server.set({ ...s, requests: { ...s.requests, [id]: request } });
      return { kind: 'accepted', checkoutRequestId: id, expiresAt: t + PROMPT_LIFETIME_MS, reused: false };
    },

    async queryStatus(checkoutRequestId: string): Promise<StatusResult> {
      await latency();
      const r = server.get().requests[checkoutRequestId];
      if (!r) throw new PaymentServiceError('not_found', 'Unknown checkout request.');
      const t = now();
      // The status API can lag the ledger: "still being processed".
      if (r.outcome === 'delayed_paid' && t < r.createdAt + QUERY_VISIBLE_AFTER_MS) return { state: 'pending' };
      const ev = evaluate(r, t);
      if (ev.state === 'pending') return { state: 'pending' };
      if (ev.state === 'success') {
        settle(r.orderRef);
        const p = server.get().payments[r.orderRef]!;
        return { state: 'success', receipt: p.receipt, paidAt: p.paidAt, resultCode: RESULT_CODES.success.code };
      }
      const rc = RESULT_CODES[ev.reason];
      return { state: 'failed', reason: ev.reason, resultCode: rc.code, resultDesc: rc.desc };
    },

    async cancel(checkoutRequestId: string): Promise<void> {
      await latency();
      const s = server.get();
      const r = s.requests[checkoutRequestId];
      if (!r || evaluate(r, now()).state !== 'pending') return;
      server.set({ ...s, requests: { ...s.requests, [r.id]: { ...r, abandoned: true } } });
    },

    async lookupPayment({ orderRef, msisdn }): Promise<LookupResult> {
      await latency();
      settle(orderRef);
      const s = server.get();
      const paid = s.payments[orderRef];
      if (paid && paid.msisdn === msisdn) {
        return { state: 'paid', receipt: paid.receipt, paidAt: paid.paidAt, amount: paid.amount };
      }
      const t = now();
      const mine = Object.values(s.requests)
        .filter((r) => r.orderRef === orderRef && r.msisdn === msisdn)
        .sort((a, b) => b.createdAt - a.createdAt);
      const latest = mine[0];
      if (!latest) return { state: 'not_found' };
      if (isLive(latest, t)) return { state: 'pending' };
      const ev = evaluate(latest, t);
      if (ev.state === 'failed') return { state: 'failed', reason: ev.reason };
      return { state: 'not_found' }; // prompt lapsed with no answer
    },

    handsetRespond(checkoutRequestId, decision) {
      const s = server.get();
      const r = s.requests[checkoutRequestId];
      if (!r || r.outcome !== 'manual' || r.decision || r.abandoned) return;
      server.set({ ...s, requests: { ...s.requests, [r.id]: { ...r, decision } } });
    },

    livePrompts() {
      const t = now();
      return Object.values(server.get().requests)
        .filter((r) => isLive(r, t))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    reset() {
      server.set({ requests: {}, payments: {} });
    },
  };
  return service;
}

/** The app-wide instance. */
export const mockMpesa: MockMpesa = createMockMpesa();
