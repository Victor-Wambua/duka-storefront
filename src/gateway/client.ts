import { GATEWAY_KEY, GATEWAY_URL, REQUEST_TIMEOUT_MS } from './config';

/** The gateway's public payment states. Always read the current one from `payment.status`. */
export type GatewayStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'needs_review';

export interface GatewayPayment {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  phone_masked: string;
  status: GatewayStatus;
  result_code?: number;
  result_desc?: string;
  mpesa_receipt?: string;
  checkout_request_id?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  flags: string[];
}

export interface CreatePaymentInput {
  amount: number;
  /** any Kenyan format; the gateway normalises it */
  phone: string;
  /** our order number */
  reference: string;
  description?: string;
  /** mock mode only */
  scenario?: string;
}

export interface GatewayConfig {
  mode: string;
  moves_real_money: boolean;
  limits: { publishable_key_max_amount: number };
  scenarios: string[];
}

export type GatewayErrorKind =
  | 'unreachable'
  | 'rate_limited'
  | 'over_cap'
  | 'validation'
  | 'idempotency_conflict'
  | 'reference_pending'
  | 'unauthorized'
  | 'not_found'
  | 'server';

export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly field: string | null;
  readonly retryAfterSec: number | null;
  constructor(
    kind: GatewayErrorKind,
    message: string,
    extra: { status?: number; code?: string; field?: string; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = 'GatewayError';
    this.kind = kind;
    this.status = extra.status ?? null;
    this.code = extra.code ?? null;
    this.field = extra.field ?? null;
    this.retryAfterSec = extra.retryAfterSec ?? null;
  }
}

export interface GatewayClient {
  /** Unauthenticated reachability probe: GET /v1/config. */
  config(): Promise<GatewayConfig>;
  createPayment(input: CreatePaymentInput, idempotencyKey: string): Promise<{ payment: GatewayPayment; replayed: boolean }>;
  getPayment(id: string): Promise<GatewayPayment>;
  /** Newest first. */
  listByReference(reference: string): Promise<GatewayPayment[]>;
}

/** Retry-After is seconds or an HTTP date; clamp to something a person will wait for. */
export function parseRetryAfter(header: string | null, nowMs: number = Date.now()): number | null {
  if (!header) return null;
  const t = header.trim();
  let sec: number;
  if (/^\d+$/.test(t)) sec = Number(t);
  else {
    const at = Date.parse(t);
    if (Number.isNaN(at)) return null;
    sec = Math.ceil((at - nowMs) / 1000);
  }
  return Math.min(600, Math.max(1, sec));
}

interface ClientOptions {
  baseUrl?: string;
  key?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createGatewayClient(opts: ClientOptions = {}): GatewayClient {
  const base = (opts.baseUrl ?? GATEWAY_URL).replace(/\/+$/, '');
  const key = opts.key ?? GATEWAY_KEY;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const doFetch = (input: string, init: RequestInit) => (opts.fetch ?? globalThis.fetch.bind(globalThis))(input, init);

  async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        signal: ctrl.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(init.auth === false ? {} : { Authorization: `Bearer ${key}` }),
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new GatewayError('unreachable', 'Could not reach the payment gateway.');
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON: handled below */
    }
    const body = (typeof json === 'object' && json !== null ? json : {}) as {
      data?: unknown;
      error?: { code?: string; message?: string; field?: string };
    };

    if (res.ok && body.data !== undefined) return { status: res.status, data: body.data };

    const err = body.error ?? {};
    const code = err.code ?? '';
    const message = err.message || `The gateway answered with HTTP ${res.status}.`;
    const extra = {
      status: res.status,
      ...(code ? { code } : {}),
      ...(err.field ? { field: err.field } : {}),
    };
    if (res.status === 429) {
      throw new GatewayError('rate_limited', message, { ...extra, retryAfterSec: parseRetryAfter(res.headers.get('Retry-After')) ?? 30 });
    }
    if (code === 'amount_exceeds_key_cap') throw new GatewayError('over_cap', message, extra);
    if (code === 'idempotency_conflict') throw new GatewayError('idempotency_conflict', message, extra);
    if (code === 'reference_pending') throw new GatewayError('reference_pending', message, extra);
    if (res.status === 401) throw new GatewayError('unauthorized', message, extra);
    if (res.status === 404) throw new GatewayError('not_found', message, extra);
    if (res.status === 400 || res.status === 422) throw new GatewayError('validation', message, extra);
    throw new GatewayError('server', message, extra);
  }

  return {
    async config() {
      const r = await call('/v1/config', { auth: false });
      return r.data as GatewayConfig;
    },
    async createPayment(input, idempotencyKey) {
      const r = await call('/v1/payments', { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } });
      return { payment: r.data as GatewayPayment, replayed: r.status === 200 };
    },
    async getPayment(id) {
      const r = await call(`/v1/payments/${encodeURIComponent(id)}`);
      return r.data as GatewayPayment;
    },
    async listByReference(reference) {
      const r = await call(`/v1/payments?reference=${encodeURIComponent(reference)}&limit=20`);
      return (r.data as { items: GatewayPayment[] }).items;
    },
  };
}
