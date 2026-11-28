import { vi } from 'vitest';
import type { GatewayPayment, GatewayStatus } from '../src/gateway/client';

/**
 * A stand-in for the live gateway's HTTP API, installed over `fetch`. It follows the documented
 * contract (docs/API.md in mpesa-gateway) and the mock scenarios' timelines, driven by the
 * (fake) clock so tests can advance through a payment's life. Tests never touch the network.
 */
export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

interface Stored {
  payment: GatewayPayment;
  scenario: string;
  bodyKey: string;
  createdMs: number;
}

export interface FakeGateway {
  calls: Call[];
  posts(): Call[];
  payments(): GatewayPayment[];
  /** next POST fails */
  failNext(kind: 'network' | 'rate_limit' | 'cap' | 'server' | 'validation', opts?: { retryAfter?: string }): void;
  /** every request fails like a dead network */
  setDown(down: boolean): void;
  /** force a stored payment into a state (e.g. to simulate it changing elsewhere) */
  force(id: string, status: GatewayStatus, patch?: Partial<GatewayPayment>): void;
  restore(): void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const err = (status: number, code: string, message: string, field?: string, headers: Record<string, string> = {}) =>
  json(status, { error: { code, message, ...(field ? { field } : {}) } }, headers);

/** Status of a mock payment at `t` ms after creation, per the documented scenario table. */
function statusAt(scenario: string, t: number): { status: GatewayStatus; code?: number; desc?: string; flags: string[] } {
  const ok = { code: 0, desc: 'The service request is processed successfully.' };
  switch (scenario) {
    case 'success':
    case 'duplicate_callback':
      return t >= 3000 ? { status: 'succeeded', ...ok, flags: [] } : { status: 'pending', flags: [] };
    case 'insufficient_funds':
      return t >= 3000 ? { status: 'failed', code: 1, desc: 'The balance is insufficient for the transaction.', flags: [] } : { status: 'pending', flags: [] };
    case 'wrong_pin':
      return t >= 3000 ? { status: 'failed', code: 2001, desc: 'The initiator information is invalid.', flags: [] } : { status: 'pending', flags: [] };
    case 'cancelled_by_user':
      return t >= 3000 ? { status: 'cancelled', code: 1032, desc: 'Request cancelled by user', flags: [] } : { status: 'pending', flags: [] };
    case 'timeout_no_callback':
      return t >= 61_000 ? { status: 'timed_out', code: 1037, desc: 'DS timeout.', flags: [] } : { status: 'pending', flags: [] };
    case 'late_success':
      if (t >= 105_000) return { status: 'needs_review', flags: ['no_result_before_deadline', 'late_success'] };
      return t >= 90_000 ? { status: 'timed_out', flags: ['no_result_before_deadline'] } : { status: 'pending', flags: [] };
    case 'callback_then_query_disagree':
      return t >= 3000 ? { status: 'needs_review', flags: ['callback_query_mismatch'] } : { status: 'pending', flags: [] };
    default:
      return { status: 'pending', flags: [] };
  }
}

/**
 * How a stubbed SANDBOX payment ends. The cancelled (1032, ~8 s) and no-response (1037, ~26 s) timelines are what
 * the real Daraja sandbox was seen to do. A success is a pure stand-in: a real one has never been observed.
 */
export type SandboxOutcome = 'success' | 'cancelled' | 'no_response' | 'pending' | 'phone_not_approved';

function sandboxStatusAt(outcome: SandboxOutcome, t: number): { status: GatewayStatus; code?: number; desc?: string; flags: string[] } {
  switch (outcome) {
    case 'success':
      return t >= 5000 ? { status: 'succeeded', code: 0, desc: 'The service request is processed successfully.', flags: [] } : { status: 'pending', flags: [] };
    case 'cancelled':
      return t >= 8000 ? { status: 'cancelled', code: 1032, desc: 'Request Cancelled by user', flags: [] } : { status: 'pending', flags: [] };
    case 'no_response':
      return t >= 26_000 ? { status: 'timed_out', code: 1037, desc: 'DS timeout user cannot be reached', flags: [] } : { status: 'pending', flags: [] };
    default:
      return { status: 'pending', flags: [] };
  }
}

/** ids stay unique across installs, like the real gateway's, because the app keeps per-payment memory */
let globalSeq = 0;

export function installFakeGateway(
  opts: { capKes?: number; sandbox?: { outcome: SandboxOutcome; phonePolicy?: 'any_number' | 'approved_numbers_only' } } = {},
): FakeGateway {
  const sandbox = opts.sandbox ?? null;
  const cap = opts.capKes ?? (sandbox ? 100 : 1000);
  const calls: Call[] = [];
  const byKey = new Map<string, Stored>();
  const byId = new Map<string, Stored>();
  const forced = new Map<string, Partial<GatewayPayment>>();
  let down = false;
  let nextFail: { kind: string; retryAfter?: string } | null = null;

  const view = (s: Stored): GatewayPayment => {
    const st = sandbox ? sandboxStatusAt(sandbox.outcome, Date.now() - s.createdMs) : statusAt(s.scenario, Date.now() - s.createdMs);
    const base: GatewayPayment = {
      ...s.payment,
      status: st.status,
      flags: st.flags,
      ...(st.code !== undefined ? { result_code: st.code } : {}),
      ...(st.desc ? { result_desc: st.desc } : {}),
      ...(st.status === 'succeeded' ? { mpesa_receipt: `${sandbox ? 'SBX' : 'MOCK'}${s.payment.id.slice(-6).toUpperCase()}` } : {}),
      updated_at: new Date(Date.now()).toISOString(),
    };
    return { ...base, ...(forced.get(s.payment.id) ?? {}) };
  };

  const handler = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname + url.search, headers, body });
    if (down) throw new TypeError('Failed to fetch');

    if (url.pathname === '/v1/config') {
      if (sandbox) {
        return json(200, {
          data: { mode: 'sandbox', moves_real_money: null, phone_policy: sandbox.phonePolicy ?? 'any_number', limits: { publishable_key_max_amount: cap }, scenarios: [] },
        });
      }
      return json(200, { data: { mode: 'mock', moves_real_money: false, limits: { publishable_key_max_amount: cap }, scenarios: [] } });
    }

    if (method === 'POST' && url.pathname === '/v1/payments') {
      if (nextFail) {
        const f = nextFail;
        nextFail = null;
        if (f.kind === 'network') throw new TypeError('Failed to fetch');
        if (f.kind === 'rate_limit') return err(429, 'rate_limited', 'Too many requests', undefined, { 'Retry-After': f.retryAfter ?? '30' });
        if (f.kind === 'cap') return err(422, 'amount_exceeds_key_cap', 'Amount is over the cap for this key');
        if (f.kind === 'validation') return err(422, 'validation_error', 'phone must be a Kenyan mobile number', 'phone');
        return err(503, 'not_configured', 'Not configured');
      }
      const key = headers['Idempotency-Key'];
      if (!key) return err(400, 'idempotency_key_required', 'Idempotency-Key required');
      if (sandbox && body && 'scenario' in body) return err(400, 'validation_error', 'scenario is not accepted in sandbox mode', 'scenario');
      if (sandbox?.outcome === 'phone_not_approved') return err(403, 'phone_not_approved', 'This sandbox only accepts approved phone numbers');
      if (typeof body?.amount === 'number' && body.amount > cap) return err(422, 'amount_exceeds_key_cap', 'Amount is over the cap for this key');
      const bodyKey = JSON.stringify(body, Object.keys(body ?? {}).sort());
      const seen = byKey.get(key);
      if (seen) {
        if (seen.bodyKey !== bodyKey) return err(409, 'idempotency_conflict', 'Same key, different body');
        return json(200, { data: view(seen) });
      }
      const live = [...byId.values()].find((s) => s.payment.reference === body?.reference && view(s).status === 'pending');
      if (live) return err(409, 'reference_pending', 'A payment for this reference is in flight');
      const seq = ++globalSeq;
      const created = new Date(Date.now()).toISOString();
      const stored: Stored = {
        scenario: String(body?.scenario ?? 'success'),
        bodyKey,
        createdMs: Date.now(),
        payment: {
          id: `pay_fake${String(seq).padStart(4, '0')}`,
          reference: String(body?.reference),
          amount: Number(body?.amount),
          currency: 'KES',
          phone_masked: '2547****001',
          status: 'pending',
          created_at: created,
          updated_at: created,
          expires_at: new Date(Date.now() + (sandbox ? 150_000 : 90_000)).toISOString(),
          flags: [],
          checkout_request_id: `ws_CO_${sandbox ? 'SBX' : 'MOCK'}_fake${seq}`,
        },
      };
      byKey.set(key, stored);
      byId.set(stored.payment.id, stored);
      return json(202, { data: { ...stored.payment } });
    }

    if (method === 'GET' && url.pathname === '/v1/payments') {
      const ref = url.searchParams.get('reference');
      const items = [...byId.values()]
        .filter((s) => !ref || s.payment.reference === ref)
        .map(view)
        .reverse();
      return json(200, { data: { items, next_cursor: null } });
    }

    const m = /^\/v1\/payments\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && m) {
      const s = byId.get(decodeURIComponent(m[1]!));
      return s ? json(200, { data: view(s) }) : err(404, 'not_found', 'No such payment');
    }
    return err(404, 'not_found', 'No such route');
  };

  const spy = vi.fn(handler);
  vi.stubGlobal('fetch', spy);

  return {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST'),
    payments: () => [...byId.values()].map(view),
    failNext: (kind, o = {}) => {
      nextFail = { kind, ...(o.retryAfter ? { retryAfter: o.retryAfter } : {}) };
    },
    setDown: (d) => {
      down = d;
    },
    force: (id, status, patch = {}) => {
      forced.set(id, { status, ...patch });
    },
    restore: () => vi.unstubAllGlobals(),
  };
}
