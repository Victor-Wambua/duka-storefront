import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, migrateEnvelope, parseEnvelope } from '../src/lib/persist';
import { CART_VERSION, cartSpec, emptyCart, type CartState } from '../src/state/cart';

beforeEach(() => localStorage.clear());

describe('parseEnvelope', () => {
  it('reads a well-formed envelope and rejects junk', () => {
    expect(parseEnvelope('{"v":2,"data":{}}')).toEqual({ v: 2, data: {} });
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('{"data":1}')).toBeNull();
    expect(parseEnvelope('[1,2]')).toBeNull();
    expect(parseEnvelope(null)).toBeNull();
  });
});

describe('cart schema migration', () => {
  it('upgrades v1 { items } to v2 { lines, promoCode, areaId }', () => {
    const v1 = { v: 1, data: { items: [{ variantId: 'maize-flour:1', qty: 3 }, { variantId: 'sufuria:0', qty: 1 }], promo: 'KARIBU10' } };
    const out = migrateEnvelope(v1, cartSpec);
    expect(out).toEqual({
      lines: [
        { productId: 'maize-flour', variantId: 'maize-flour:1', qty: 3 },
        { productId: 'sufuria', variantId: 'sufuria:0', qty: 1 },
      ],
      promoCode: 'KARIBU10',
      areaId: null,
    });
  });
  it('drops malformed v1 items instead of crashing', () => {
    const out = migrateEnvelope({ v: 1, data: { items: [{ variantId: 5, qty: 'x' }, null, { variantId: 'a:0', qty: 2 }] } }, cartSpec);
    expect(out.lines).toEqual([{ productId: 'a', variantId: 'a:0', qty: 2 }]);
  });
  it('passes current-version data through unchanged', () => {
    const cur: CartState = { lines: [{ productId: 'a', variantId: 'a:0', qty: 2 }], promoCode: null, areaId: 'cbd' };
    expect(migrateEnvelope({ v: CART_VERSION, data: cur }, cartSpec)).toEqual(cur);
  });
  it('filters invalid lines in current-version data', () => {
    const out = migrateEnvelope({ v: CART_VERSION, data: { lines: [{ productId: 'a', variantId: 'a:0', qty: 0 }, { productId: 'a', variantId: 'a:1', qty: 2 }], promoCode: 7 } }, cartSpec);
    expect(out.lines).toHaveLength(1);
    expect(out.promoCode).toBeNull();
  });
  it('falls back to an empty cart for unknown future versions, junk, or null', () => {
    expect(migrateEnvelope({ v: 99, data: { lines: [] } }, cartSpec)).toEqual(emptyCart());
    expect(migrateEnvelope({ v: 2, data: 'nope' }, cartSpec)).toEqual(emptyCart());
    expect(migrateEnvelope(null, cartSpec)).toEqual(emptyCart());
    expect(migrateEnvelope({ v: 0, data: {} }, cartSpec)).toEqual(emptyCart());
  });
});

describe('createStore', () => {
  it('loads and migrates what is in localStorage', () => {
    localStorage.setItem('duka.cart', JSON.stringify({ v: 1, data: { items: [{ variantId: 'a:0', qty: 2 }] } }));
    const store = createStore(cartSpec);
    expect(store.get().lines).toHaveLength(1);
  });
  it('writes a versioned envelope and notifies subscribers', () => {
    const store = createStore(cartSpec);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set((s) => ({ ...s, areaId: 'cbd' }));
    expect(calls).toBe(1);
    expect(JSON.parse(localStorage.getItem('duka.cart')!)).toEqual({ v: CART_VERSION, data: { lines: [], promoCode: null, areaId: 'cbd' } });
    off();
    store.set(emptyCart());
    expect(calls).toBe(1);
  });
  it('survives corrupt storage', () => {
    localStorage.setItem('duka.cart', '{{{');
    expect(createStore(cartSpec).get()).toEqual(emptyCart());
  });
});
