import type { Page, Route } from '@playwright/test';
import { GATEWAY } from './fixtures';

/**
 * The gateway's HTTP API, stubbed with page.route. It follows docs/API.md in the gateway repo.
 * Outcomes arrive after ~1.5 s (the real mock takes ~3 s; the timeline is not what these tests are about).
 */
type Behaviour = 'pending' | 'succeeded' | 'wrong_pin' | 'timed_out' | 'needs_review' | 'cancelled';

const OUTCOME: Record<string, Behaviour> = {
  success: 'succeeded',
  duplicate_callback: 'succeeded',
  wrong_pin: 'wrong_pin',
  cancelled_by_user: 'cancelled',
  timeout_no_callback: 'timed_out',
  late_success: 'needs_review',
  callback_then_query_disagree: 'needs_review',
};

interface Stored {
  id: string;
  reference: string;
  amount: number;
  scenario: string;
  key: string;
  createdMs: number;
  created: string;
}

export interface GatewayStub {
  posts: { headers: Record<string, string>; body: Record<string, unknown> }[];
  created: Stored[];
  gets: number;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
};

export async function stubGateway(
  page: Page,
  opts: { capKes?: number; failCreate?: 'rate_limited' | null; delayMs?: number } = {},
): Promise<GatewayStub> {
  const cap = opts.capKes ?? 1000;
  const delay = opts.delayMs ?? 1500;
  const stub: GatewayStub = { posts: [], created: [], gets: 0 };
  let seq = 0;

  const json = (route: Route, status: number, body: unknown, extra: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: 'application/json', headers: { ...CORS, ...extra }, body: JSON.stringify(body) });

  const view = (s: Stored) => {
    const elapsed = Date.now() - s.createdMs;
    const beh: Behaviour = elapsed >= delay ? (OUTCOME[s.scenario] ?? 'succeeded') : 'pending';
    const base = {
      id: s.id,
      reference: s.reference,
      amount: s.amount,
      currency: 'KES',
      phone_masked: '2547****001',
      created_at: s.created,
      updated_at: new Date().toISOString(),
      expires_at: new Date(s.createdMs + 90_000).toISOString(),
      checkout_request_id: `ws_CO_MOCK_${s.id.slice(4)}`,
    };
    switch (beh) {
      case 'succeeded':
        return { ...base, status: 'succeeded', result_code: 0, result_desc: 'The service request is processed successfully.', mpesa_receipt: `MOCK${s.id.slice(-6).toUpperCase()}`, flags: [] };
      case 'wrong_pin':
        return { ...base, status: 'failed', result_code: 2001, result_desc: 'The initiator information is invalid.', flags: [] };
      case 'cancelled':
        return { ...base, status: 'cancelled', result_code: 1032, result_desc: 'Request cancelled by user', flags: [] };
      case 'timed_out':
        return { ...base, status: 'timed_out', result_code: 1037, result_desc: 'DS timeout.', flags: ['no_result_before_deadline'] };
      case 'needs_review':
        return { ...base, status: 'needs_review', flags: s.scenario === 'late_success' ? ['no_result_before_deadline', 'late_success'] : ['callback_query_mismatch'] };
      default:
        return { ...base, status: 'pending', flags: [] };
    }
  };

  await page.route(`${GATEWAY}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    if (url.pathname === '/v1/config') {
      return json(route, 200, { data: { mode: 'mock', moves_real_money: false, limits: { publishable_key_max_amount: cap }, scenarios: [] } });
    }
    if (method === 'POST' && url.pathname === '/v1/payments') {
      const headers = req.headers();
      const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      stub.posts.push({ headers, body });
      if (opts.failCreate === 'rate_limited') {
        return json(route, 429, { error: { code: 'rate_limited', message: 'Too many requests' } }, { 'Retry-After': '30' });
      }
      const key = headers['idempotency-key'] ?? '';
      const seen = stub.created.find((c) => c.key === key);
      if (seen) return json(route, 200, { data: view(seen) });
      const now = Date.now();
      const s: Stored = {
        id: `pay_e2e${String(++seq).padStart(4, '0')}`,
        reference: String(body.reference),
        amount: Number(body.amount),
        scenario: String(body.scenario ?? 'success'),
        key,
        createdMs: now,
        created: new Date(now).toISOString(),
      };
      stub.created.push(s);
      return json(route, 202, { data: view(s) });
    }
    if (method === 'GET' && url.pathname === '/v1/payments') {
      const ref = url.searchParams.get('reference');
      const items = stub.created.filter((c) => !ref || c.reference === ref).map(view).reverse();
      return json(route, 200, { data: { items, next_cursor: null } });
    }
    const m = /^\/v1\/payments\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && m) {
      stub.gets++;
      const s = stub.created.find((c) => c.id === m[1]);
      return s ? json(route, 200, { data: view(s) }) : json(route, 404, { error: { code: 'not_found', message: 'No such payment' } });
    }
    return json(route, 404, { error: { code: 'not_found', message: 'No such route' } });
  });
  return stub;
}
