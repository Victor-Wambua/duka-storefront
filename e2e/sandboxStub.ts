import type { Page, Route } from '@playwright/test';
import { SANDBOX } from './fixtures';

/**
 * The Safaricom sandbox gateway's HTTP API, stubbed with page.route (this suite never reaches the real one,
 * which would send a real prompt). Same contract as the mock instance, except: mode 'sandbox', no scenarios,
 * and a `scenario` field is refused. The cancelled (1032) and no-response (1037) endings are ones the real
 * sandbox produced; a success is a stand-in, because a payment completed with a PIN has never been observed.
 */
export type SandboxEnding = 'success' | 'cancelled_1032' | 'no_response_1037' | 'phone_not_approved' | 'pending';

interface Stored {
  id: string;
  reference: string;
  amount: number;
  key: string;
  createdMs: number;
  created: string;
}

export interface SandboxStub {
  posts: { headers: Record<string, string>; body: Record<string, unknown> }[];
  created: Stored[];
  /** every request that reached the sandbox host, whatever it was */
  requests: string[];
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
};

export async function stubSandbox(
  page: Page,
  opts: { ending?: SandboxEnding; delayMs?: number; phonePolicy?: 'any_number' | 'approved_numbers_only' } = {},
): Promise<SandboxStub> {
  const ending = opts.ending ?? 'success';
  const delay = opts.delayMs ?? 1500;
  const stub: SandboxStub = { posts: [], created: [], requests: [] };
  let seq = 0;

  const json = (route: Route, status: number, body: unknown, extra: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: 'application/json', headers: { ...CORS, ...extra }, body: JSON.stringify(body) });

  const view = (s: Stored) => {
    const done = Date.now() - s.createdMs >= delay;
    const base = {
      id: s.id,
      reference: s.reference,
      amount: s.amount,
      currency: 'KES',
      phone_masked: '2547****001',
      created_at: s.created,
      updated_at: new Date().toISOString(),
      expires_at: new Date(s.createdMs + 150_000).toISOString(),
      checkout_request_id: `ws_CO_SBX_${s.id.slice(4)}`,
    };
    if (!done || ending === 'pending') return { ...base, status: 'pending', flags: [] };
    if (ending === 'cancelled_1032') return { ...base, status: 'cancelled', result_code: 1032, result_desc: 'Request Cancelled by user', flags: [] };
    if (ending === 'no_response_1037') return { ...base, status: 'timed_out', result_code: 1037, result_desc: 'DS timeout user cannot be reached', flags: [] };
    return { ...base, status: 'succeeded', result_code: 0, result_desc: 'The service request is processed successfully.', mpesa_receipt: `SBX${s.id.slice(-6).toUpperCase()}`, flags: [] };
  };

  await page.route(`${SANDBOX}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    stub.requests.push(`${method} ${url.pathname}`);
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    if (url.pathname === '/v1/config') {
      return json(route, 200, {
        data: { mode: 'sandbox', moves_real_money: null, phone_policy: opts.phonePolicy ?? 'any_number', limits: { publishable_key_max_amount: 100 }, scenarios: [] },
      });
    }
    if (method === 'POST' && url.pathname === '/v1/payments') {
      const headers = req.headers();
      const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      stub.posts.push({ headers, body });
      if ('scenario' in body) return json(route, 400, { error: { code: 'validation_error', message: 'scenario is not accepted in sandbox mode', field: 'scenario' } });
      if (ending === 'phone_not_approved') {
        return json(route, 403, { error: { code: 'phone_not_approved', message: 'This sandbox only accepts approved phone numbers' } });
      }
      if (Number(body.amount) > 100) return json(route, 422, { error: { code: 'amount_exceeds_key_cap', message: 'Amount is over the cap for this key' } });
      const key = headers['idempotency-key'] ?? '';
      const seen = stub.created.find((c) => c.key === key);
      if (seen) return json(route, 200, { data: view(seen) });
      const now = Date.now();
      const s: Stored = {
        id: `pay_sbx${String(++seq).padStart(4, '0')}`,
        reference: String(body.reference),
        amount: Number(body.amount),
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
      const s = stub.created.find((c) => c.id === m[1]);
      return s ? json(route, 200, { data: view(s) }) : json(route, 404, { error: { code: 'not_found', message: 'No such payment' } });
    }
    return json(route, 404, { error: { code: 'not_found', message: 'No such route' } });
  });
  return stub;
}
