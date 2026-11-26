import { beforeEach, describe, expect, it } from 'vitest';
import { abandonOrder, finalizeCod, finalizePaid } from '../src/checkout/finalize';
import { validateCheckout } from '../src/checkout/validate';
import { getArea } from '../src/data/delivery';
import { buildCartView } from '../src/state/cartView';
import {
  fingerprintOf,
  newOrderRef,
  normaliseRef,
  upsertPending,
  type Order,
} from '../src/state/orders';
import { cartStore, inventoryStore, ordersStore, resetDemoData, sessionStore, stockOf } from '../src/state/stores';

function order(ref = 'DUKA-ABC234', over: Partial<Order> = {}): Order {
  return {
    ref,
    createdAt: 1,
    status: 'pending_payment',
    lines: [{ productId: 'maize-flour', variantId: 'maize-flour:1', name: 'Maize flour', variantLabel: '2 kg', unitPrice: 185, qty: 2 }],
    pricing: { subtotal: 370, discount: 0, deliveryFee: 0, deliveryWaived: 0, total: 370 },
    promoCode: null,
    delivery: { areaId: 'pickup', areaName: 'Pickup', kind: 'pickup', note: '' },
    customer: { name: 'A', msisdn: '254700000001' },
    payment: { method: 'mpesa', attempts: 0, checkoutRequestId: null, receipt: null, paidAt: null },
    ...over,
  };
}

beforeEach(() => resetDemoData());

describe('order references', () => {
  it('are unambiguous and unique enough', () => {
    const refs = new Set(Array.from({ length: 500 }, newOrderRef));
    expect(refs.size).toBe(500);
    for (const r of refs) expect(r).toMatch(/^DUKA-[A-HJ-NP-Z2-9]{6}$/);
  });
  it('normalise what people type', () => {
    expect(normaliseRef(' duka-abc234 ')).toBe('DUKA-ABC234');
    expect(normaliseRef('dukaabc234')).toBe('DUKA-ABC234');
    expect(normaliseRef('DUKA ABC234')).toBe('DUKA-ABC234');
  });
});

describe('upsertPending is idempotent', () => {
  it('never creates the same order twice, but lets a pending retry update who is paying', () => {
    const a = upsertPending([], order());
    const b = upsertPending(a, order('DUKA-ABC234', { customer: { name: 'A', msisdn: '254700000002' } }));
    expect(b).toHaveLength(1);
    expect(b[0]!.customer.msisdn).toBe('254700000002');
  });
  it('leaves a paid order alone', () => {
    const paid = order('DUKA-ABC234', { status: 'paid' });
    const out = upsertPending([paid], order('DUKA-ABC234', { customer: { name: 'X', msisdn: '254700000009' } }));
    expect(out).toEqual([paid]);
  });
});

describe('finalising orders', () => {
  it('finalizePaid marks paid and sells stock exactly once', () => {
    ordersStore.set([order()]);
    sessionStore.set({ orderRef: 'DUKA-ABC234', fingerprint: 'x', attempt: 1, checkoutRequestId: 'c', requestedAt: 1 });
    cartStore.set({ lines: [{ productId: 'maize-flour', variantId: 'maize-flour:1', qty: 2 }], promoCode: null, areaId: null });
    const before = stockOf('maize-flour:1');
    finalizePaid('DUKA-ABC234', 'SIMAAAAAAA', 5);
    finalizePaid('DUKA-ABC234', 'SIMAAAAAAA', 5); // replay: page reload, lookup, late callback
    expect(ordersStore.get()[0]).toMatchObject({ status: 'paid', payment: { receipt: 'SIMAAAAAAA', paidAt: 5 } });
    expect(stockOf('maize-flour:1')).toBe(before - 2);
    expect(cartStore.get().lines).toEqual([]);
    expect(sessionStore.get()).toBeNull();
  });
  it('does not clear someone else\'s cart when an old order resolves', () => {
    ordersStore.set([order()]);
    sessionStore.set({ orderRef: 'DUKA-OTHER22', fingerprint: 'x', attempt: 1, checkoutRequestId: null, requestedAt: null });
    cartStore.set({ lines: [{ productId: 'sufuria', variantId: 'sufuria:0', qty: 1 }], promoCode: null, areaId: null });
    finalizePaid('DUKA-ABC234', 'SIMBBBBBBB', 5);
    expect(cartStore.get().lines).toHaveLength(1);
  });
  it('finalizeCod confirms once and sells stock', () => {
    ordersStore.set([order()]);
    finalizeCod('DUKA-ABC234');
    finalizeCod('DUKA-ABC234');
    expect(ordersStore.get()[0]!.status).toBe('pay_on_delivery');
    expect(inventoryStore.get().sold['maize-flour:1']).toBe(2);
  });
  it('a paid order cannot be abandoned', () => {
    ordersStore.set([order('DUKA-ABC234', { status: 'paid' })]);
    abandonOrder('DUKA-ABC234');
    expect(ordersStore.get()[0]!.status).toBe('paid');
  });
});

describe('fingerprint', () => {
  it('changes when the cart, promo, area or total changes', () => {
    const base = fingerprintOf([{ variantId: 'a:0', qty: 1 }], null, 'cbd', 100);
    expect(fingerprintOf([{ variantId: 'a:0', qty: 1 }], null, 'cbd', 100)).toBe(base);
    expect(fingerprintOf([{ variantId: 'a:0', qty: 2 }], null, 'cbd', 100)).not.toBe(base);
    expect(fingerprintOf([{ variantId: 'a:0', qty: 1 }], 'KARIBU10', 'cbd', 100)).not.toBe(base);
    expect(fingerprintOf([{ variantId: 'a:0', qty: 1 }], null, 'west', 100)).not.toBe(base);
    expect(fingerprintOf([{ variantId: 'a:0', qty: 1 }], null, 'cbd', 101)).not.toBe(base);
  });
});

describe('cart view', () => {
  it('prices lines, ignores a promo that no longer qualifies, and flags stock limits', () => {
    const view = buildCartView(
      { lines: [{ productId: 'tomato-paste', variantId: 'tomato-paste:0', qty: 3 }], promoCode: 'KARIBU10', areaId: 'cbd' },
      () => 3,
    );
    expect(view.pricing).toMatchObject({ subtotal: 120, discount: 0, deliveryFee: 150, total: 270 });
    expect(view.promo).toMatchObject({ ok: false, reason: 'min_subtotal' });
    expect(view.lines[0]).toMatchObject({ atLimit: true, available: 3 });
  });
  it('skips lines whose variant no longer exists', () => {
    const view = buildCartView({ lines: [{ productId: 'gone', variantId: 'gone:0', qty: 1 }], promoCode: null, areaId: null }, () => 9);
    expect(view.lines).toEqual([]);
  });
});

describe('validateCheckout', () => {
  const ok = { name: 'Wanjiru', phone: '0712345678', address: 'Kilimani, Sample Rd', method: 'mpesa' as const };
  it('accepts a complete delivery order', () => {
    expect(validateCheckout(ok, getArea('west'))).toEqual({});
  });
  it('does not need an address for pickup', () => {
    expect(validateCheckout({ ...ok, address: '' }, getArea('pickup'))).toEqual({});
  });
  it('reports every problem at once', () => {
    expect(Object.keys(validateCheckout({ name: ' ', phone: '12', address: '', method: 'mpesa' }, getArea('west'))).sort()).toEqual(['address', 'name', 'phone']);
    expect(validateCheckout(ok, null)).toHaveProperty('area');
  });
});
