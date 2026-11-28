import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGatewayClient, GatewayError, parseRetryAfter } from '../src/gateway/client';
import { GATEWAY_KEY, GATEWAY_URL } from '../src/gateway/config';

const payment = { id: 'pay_1', reference: 'DUKA-AAAAAA', amount: 100, currency: 'KES', phone_masked: '2547****001', status: 'pending', created_at: 'a', updated_at: 'a', expires_at: 'b', flags: [] };
const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
const client = () => createGatewayClient({ fetch: fetchMock as unknown as typeof fetch, baseUrl: 'https://gw.test/', key: 'pk_test' });
const lastInit = () => fetchMock.mock.calls.at(-1)![1] as RequestInit & { headers: Record<string, string> };

beforeEach(() => {
  fetchMock = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe('config', () => {
  it('points at the deployed gateway with the publishable demo key, never a secret key', () => {
    expect(GATEWAY_URL).toBe('https://mpesa-gateway.victorwambua004.workers.dev');
    expect(GATEWAY_KEY).toMatch(/^pk_/);
  });
});

describe('createPayment', () => {
  it('sends the key, the Idempotency-Key and the JSON body, and reports a new payment as not replayed', async () => {
    fetchMock.mockResolvedValue(res(202, { data: payment }));
    const out = await client().createPayment({ amount: 100, phone: '254700000001', reference: 'DUKA-AAAAAA', scenario: 'success' }, 'key-12345678');
    expect(out).toEqual({ payment, replayed: false });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://gw.test/v1/payments');
    expect(lastInit().method).toBe('POST');
    expect(lastInit().headers).toMatchObject({ Authorization: 'Bearer pk_test', 'Idempotency-Key': 'key-12345678', 'Content-Type': 'application/json' });
    expect(JSON.parse(lastInit().body as string)).toEqual({ amount: 100, phone: '254700000001', reference: 'DUKA-AAAAAA', scenario: 'success' });
  });

  it('a 200 means the same Idempotency-Key was seen before: the same payment, replayed', async () => {
    fetchMock.mockResolvedValue(res(200, { data: payment }));
    expect((await client().createPayment({ amount: 100, phone: '254700000001', reference: 'r' }, 'key-12345678')).replayed).toBe(true);
  });

  it.each([
    [429, 'rate_limited', 'rate_limited'],
    [422, 'amount_exceeds_key_cap', 'over_cap'],
    [422, 'validation_error', 'validation'],
    [400, 'validation_error', 'validation'],
    [409, 'idempotency_conflict', 'idempotency_conflict'],
    [409, 'reference_pending', 'reference_pending'],
    [401, 'unauthorized', 'unauthorized'],
    [404, 'not_found', 'not_found'],
    [503, 'not_configured', 'server'],
    [500, 'internal_error', 'server'],
  ])('HTTP %i %s becomes GatewayError(%s)', async (status, code, kind) => {
    fetchMock.mockResolvedValue(res(status, { error: { code, message: 'm', field: 'phone' } }, { 'Retry-After': '12' }));
    const e = await client().createPayment({ amount: 1, phone: 'x', reference: 'r' }, 'key-12345678').catch((x) => x);
    expect(e).toBeInstanceOf(GatewayError);
    expect(e).toMatchObject({ kind, status, code, field: 'phone' });
    if (kind === 'rate_limited') expect(e.retryAfterSec).toBe(12);
  });

  it('a rate limit with no Retry-After still gets a sensible wait', async () => {
    fetchMock.mockResolvedValue(res(429, { error: { code: 'rate_limited', message: 'slow down' } }));
    const e = await client().getPayment('pay_1').catch((x) => x);
    expect(e).toMatchObject({ kind: 'rate_limited', retryAfterSec: 30 });
  });

  it('a network failure is "unreachable"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(client().getPayment('pay_1')).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('a request that hangs is aborted and reported as unreachable', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const p = createGatewayClient({ fetch: fetchMock as unknown as typeof fetch, baseUrl: 'https://gw.test', key: 'k', timeoutMs: 5000 }).getPayment('pay_1').catch((x) => x);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await p).toMatchObject({ kind: 'unreachable' });
  });

  it('an HTML or empty error page is a server error, not a crash', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 502 }));
    await expect(client().getPayment('pay_1')).rejects.toMatchObject({ kind: 'server', status: 502 });
  });
});

describe('reads', () => {
  it('getPayment and listByReference use the key; config does not', async () => {
    fetchMock.mockResolvedValue(res(200, { data: payment }));
    await client().getPayment('pay_1');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://gw.test/v1/payments/pay_1');
    expect(lastInit().headers.Authorization).toBe('Bearer pk_test');

    fetchMock.mockResolvedValue(res(200, { data: { items: [payment], next_cursor: null } }));
    expect(await client().listByReference('DUKA-AAAAAA')).toEqual([payment]);
    expect(fetchMock.mock.calls[1]![0]).toBe('https://gw.test/v1/payments?reference=DUKA-AAAAAA&limit=20');

    fetchMock.mockResolvedValue(res(200, { data: { mode: 'mock', limits: { publishable_key_max_amount: 1000 }, scenarios: [], moves_real_money: false } }));
    await client().config();
    expect(fetchMock.mock.calls[2]![0]).toBe('https://gw.test/v1/config');
    expect(lastInit().headers.Authorization).toBeUndefined();
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds, reads HTTP dates, clamps, and ignores nonsense', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter('0')).toBe(1);
    expect(parseRetryAfter('99999')).toBe(600);
    expect(parseRetryAfter('Sat, 28 Nov 2026 12:00:20 GMT', Date.parse('2026-11-28T12:00:00Z'))).toBe(20);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});
