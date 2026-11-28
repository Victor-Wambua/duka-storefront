import { describe, expect, it, vi } from 'vitest';
import { createGatewayClient, GatewayError, type GatewayClient, type GatewayPayment } from '../src/gateway/client';
import { SANDBOX_FAIL_COPY } from '../src/gateway/copy';
import {
  SANDBOX_BACKOFF_MS,
  SANDBOX_CHARGE_KES,
  SANDBOX_ID_PREFIX,
  SANDBOX_WARNING,
  SANDBOX_WINDOW_MS,
  sandboxChargeFor,
  standInNote,
} from '../src/gateway/sandbox';
import { createGatewayService, failReason, providerOfId, rawPaymentId, toStatusResult } from '../src/gateway/service';
import { createRoutingService } from '../src/payment/router';
import { PaymentServiceError, type PaymentService } from '../src/payment/types';
import { migrateEnvelope } from '../src/lib/persist';
import { providerSpec } from '../src/state/provider';

const pay = (over: Partial<GatewayPayment> = {}): GatewayPayment => ({
  id: 'pay_1',
  reference: 'DUKA-AAAAAA',
  amount: 1,
  currency: 'KES',
  phone_masked: '2547****001',
  status: 'pending',
  created_at: '2026-11-28T12:00:00.000Z',
  updated_at: '2026-11-28T12:00:00.000Z',
  expires_at: '2026-11-28T12:02:30.000Z',
  flags: [],
  checkout_request_id: 'ws_CO_x',
  ...over,
});

const fakeClient = (over: Partial<GatewayClient> = {}): GatewayClient => ({
  config: vi.fn(),
  createPayment: vi.fn().mockResolvedValue({ payment: pay(), replayed: false }),
  getPayment: vi.fn().mockResolvedValue(pay()),
  listByReference: vi.fn().mockResolvedValue([]),
  ...over,
});

const req = { orderRef: 'DUKA-AAAAAA', idempotencyKey: 'duka-key-12345', msisdn: '254700000001', amount: 620, scenario: 'success' };

describe('the KES 1 rule', () => {
  it('is KES 1 whatever the order total', () => {
    for (const total of [1, 99, 100, 385, 620, 5000, 150_000]) expect(sandboxChargeFor(total)).toBe(1);
    expect(SANDBOX_CHARGE_KES).toBe(1);
  });

  it('says what the flat charge stands in for, in the agreed words', () => {
    expect(standInNote(620)).toBe('Sandbox test charge: KES 1 stands in for the KES 620 order');
  });

  it('the sandbox service sends KES 1 to the gateway, never the order total, and no scenario', async () => {
    const client = fakeClient();
    const svc = createGatewayService({ client, sandbox: { chargeKes: SANDBOX_CHARGE_KES } });
    await svc.initiateStkPush(req);
    expect(client.createPayment).toHaveBeenCalledWith({ amount: 1, phone: '254700000001', reference: 'DUKA-AAAAAA' }, 'duka-key-12345');
    const body = vi.mocked(client.createPayment).mock.calls[0]![0];
    expect(body).not.toHaveProperty('scenario');
  });

  it('the mock gateway service still sends the order total and the scenario', async () => {
    const client = fakeClient();
    await createGatewayService({ client }).initiateStkPush(req);
    expect(client.createPayment).toHaveBeenCalledWith({ amount: 620, phone: '254700000001', reference: 'DUKA-AAAAAA', scenario: 'success' }, 'duka-key-12345');
  });

  it('a lookup matches the KES 1 payment, not the order total', async () => {
    const client = fakeClient({ listByReference: vi.fn().mockResolvedValue([pay({ status: 'succeeded', mpesa_receipt: 'RCPT1', amount: 1 })]) });
    const svc = createGatewayService({ client, sandbox: { chargeKes: 1 } });
    const res = await svc.lookupPayment({ orderRef: 'DUKA-AAAAAA', msisdn: '254700000001', amount: 620 });
    expect(res).toMatchObject({ state: 'paid', receipt: 'RCPT1', amount: 1 });
  });
});

describe('sandbox provider mapping', () => {
  const sandboxSvc = (client: GatewayClient) => createGatewayService({ client, sandbox: { chargeKes: 1 }, now: () => Date.parse('2026-11-28T12:00:00.000Z') });

  it('tags its payment ids so a later poll goes back to the sandbox host, and untags them for the gateway', async () => {
    const client = fakeClient({ getPayment: vi.fn().mockResolvedValue(pay({ status: 'succeeded', mpesa_receipt: 'R', result_code: 0 })) });
    const svc = sandboxSvc(client);
    const out = await svc.initiateStkPush(req);
    expect(out).toMatchObject({ kind: 'accepted', checkoutRequestId: `${SANDBOX_ID_PREFIX}pay_1`, windowMs: SANDBOX_WINDOW_MS });
    await svc.queryStatus(`${SANDBOX_ID_PREFIX}pay_1`);
    expect(client.getPayment).toHaveBeenCalledWith('pay_1');
    expect(svc.pollSchedule?.(`${SANDBOX_ID_PREFIX}pay_1`)).toEqual({ backoffMs: SANDBOX_BACKOFF_MS, windowMs: SANDBOX_WINDOW_MS });
    expect(svc.pollSchedule?.('pay_1')).toBeUndefined();
  });

  it('the wait window outlasts the sandbox\'s 150 s prompt timeout', () => {
    expect(SANDBOX_WINDOW_MS).toBeGreaterThan(150_000);
  });

  it('ids route to the right provider', () => {
    expect(providerOfId('sbx:pay_9')).toBe('sandbox');
    expect(providerOfId('pay_9')).toBe('gateway');
    expect(providerOfId('ws_CO_SIM_1')).toBe('simulator');
    expect(rawPaymentId('sbx:pay_9')).toBe('pay_9');
    expect(rawPaymentId('pay_9')).toBe('pay_9');
  });

  it('the router sends a sandbox id to the sandbox service and a mock id to the mock gateway, whatever is chosen now', async () => {
    const mk = (): PaymentService => ({
      initiateStkPush: vi.fn().mockResolvedValue({ kind: 'accepted', checkoutRequestId: 'x', expiresAt: 0, reused: false }),
      queryStatus: vi.fn().mockResolvedValue({ state: 'pending' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      lookupPayment: vi.fn().mockResolvedValue({ state: 'not_found' }),
      pollSchedule: vi.fn(),
    });
    const [sim, gate, sbx] = [mk(), mk(), mk()];
    const router = createRoutingService({ simulator: sim, gateway: gate, sandbox: sbx, current: () => 'gateway' });
    await router.queryStatus('sbx:pay_1');
    await router.queryStatus('pay_2');
    await router.initiateStkPush({ orderRef: 'o', idempotencyKey: 'k', msisdn: 'm', amount: 1, provider: 'sandbox' });
    await router.lookupPayment({ orderRef: 'o', msisdn: 'm', provider: 'sandbox' });
    expect(sbx.queryStatus).toHaveBeenCalledWith('sbx:pay_1');
    expect(gate.queryStatus).toHaveBeenCalledWith('pay_2');
    expect(sbx.initiateStkPush).toHaveBeenCalledTimes(1);
    expect(sbx.lookupPayment).toHaveBeenCalledTimes(1);
    expect(gate.initiateStkPush).not.toHaveBeenCalled();
    expect(sim.queryStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', 1032, 'cancelled'],
    ['failed', 1032, 'cancelled'],
    ['timed_out', 1037, 'timeout'],
    ['failed', 1037, 'timeout'],
  ] as const)('%s with ResultCode %s -> %s', (status, code, reason) => {
    expect(failReason({ status, result_code: code })).toBe(reason);
    expect(toStatusResult(pay({ status, result_code: code, result_desc: 'x' }))).toMatchObject({ state: 'failed', reason });
  });

  it('succeeded is the only success, and needs_review never is', () => {
    expect(toStatusResult(pay({ status: 'succeeded', mpesa_receipt: 'R', result_code: 0 }))).toMatchObject({ state: 'success', receipt: 'R' });
    expect(toStatusResult(pay({ status: 'needs_review', mpesa_receipt: 'R' })).state).toBe('review');
  });

  it('Safaricom\'s own 1037 answer is final: no extra late-result watch (the mock gateway keeps one)', async () => {
    const answered = pay({ status: 'timed_out', result_code: 1037, result_desc: 'no response' });
    const sbx = sandboxSvc(fakeClient({ getPayment: vi.fn().mockResolvedValue(answered) }));
    expect(await sbx.queryStatus('sbx:pay_1')).toMatchObject({ state: 'failed', reason: 'timeout' });
    const mock = createGatewayService({ client: fakeClient({ getPayment: vi.fn().mockResolvedValue(answered) }) });
    expect(await mock.queryStatus('pay_1')).toEqual({ state: 'pending', phase: 'late_watch' });
  });

  it('a timeout the gateway decided on its own (no result code) is still watched for a late result', async () => {
    const sbx = sandboxSvc(fakeClient({ getPayment: vi.fn().mockResolvedValue(pay({ status: 'timed_out' })) }));
    expect(await sbx.queryStatus('sbx:pay_1')).toEqual({ state: 'pending', phase: 'late_watch' });
  });

  it('403 phone_not_approved is its own error, not "rejected"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'phone_not_approved', message: 'not approved' } }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = createGatewayClient({ baseUrl: 'https://sbx.test', key: 'pk_x', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.createPayment({ amount: 1, phone: '254700000001', reference: 'r' }, 'duka-key-12345')).rejects.toMatchObject({ kind: 'phone_not_approved', status: 403 });
    const svc = createGatewayService({ client: fakeClient({ createPayment: vi.fn().mockRejectedValue(new GatewayError('phone_not_approved', 'no', { status: 403 })) }), sandbox: { chargeKes: 1 } });
    await expect(svc.initiateStkPush(req)).rejects.toMatchObject({ code: 'phone_not_approved' });
    await expect(svc.initiateStkPush(req)).rejects.toBeInstanceOf(PaymentServiceError);
  });

  it('429 carries Retry-After through', async () => {
    const svc = createGatewayService({ client: fakeClient({ createPayment: vi.fn().mockRejectedValue(new GatewayError('rate_limited', 'slow', { status: 429, retryAfterSec: 20 })) }), sandbox: { chargeKes: 1 } });
    await expect(svc.initiateStkPush(req)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 20 });
  });

  it('its failure copy never calls Daraja a mock and never promises that nothing was charged', () => {
    for (const { title, body } of Object.values(SANDBOX_FAIL_COPY)) {
      expect(`${title} ${body}`).not.toMatch(/mock Daraja|mock customer|nothing was charged/i);
    }
    expect(SANDBOX_FAIL_COPY.cancelled.body).toMatch(/1032/);
    expect(SANDBOX_FAIL_COPY.timeout.title).toBe('No response in time');
    expect(SANDBOX_FAIL_COPY.timeout.body).toMatch(/1037/);
  });
});

describe('provider preference with the sandbox', () => {
  const load = (data: unknown) => migrateEnvelope({ v: 1, data }, providerSpec);

  it('the default is still the mock-Daraja gateway', () => {
    expect(providerSpec.initial().choice).toBe('gateway');
    expect(migrateEnvelope(null, providerSpec).choice).toBe('gateway');
  });

  it('a saved sandbox choice is kept, and an acknowledgement smuggled into storage is dropped', () => {
    expect(load({ choice: 'sandbox', scenario: 'success' })).toEqual({ choice: 'sandbox', scenario: 'success' });
    expect(load({ choice: 'sandbox', scenario: 'success', acknowledged: true, ack: true })).toEqual({ choice: 'sandbox', scenario: 'success' });
  });

  it('warns in the agreed words', () => {
    expect(SANDBOX_WARNING).toBe(
      'This sends a real prompt to the phone number you enter. Use only your own number. Two KES 1 payments have been completed with a PIN here, which is a small sample, and we have not checked whether approving a sandbox prompt debits a real wallet. Safaricom sandbox, KES 1 test charge.',
    );
  });
});
