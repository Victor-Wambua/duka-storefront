import { describe, expect, it } from 'vitest';
import { cartCount, cartReducer, emptyCart, remainingFor, type CartState, type StockFn } from '../src/state/cart';

const stockTable: Record<string, number> = { 'a:0': 5, 'a:1': 1, 'b:0': 0 };
const stock: StockFn = (id) => stockTable[id] ?? 0;
const run = (s: CartState, ...actions: Parameters<typeof cartReducer>[1][]) =>
  actions.reduce((acc, a) => cartReducer(acc, a, stock), s);

describe('cartReducer', () => {
  it('adds a line, then merges repeated adds', () => {
    const s = run(emptyCart(), { type: 'add', productId: 'a', variantId: 'a:0' }, { type: 'add', productId: 'a', variantId: 'a:0', qty: 2 });
    expect(s.lines).toEqual([{ productId: 'a', variantId: 'a:0', qty: 3 }]);
    expect(cartCount(s)).toBe(3);
  });
  it('never exceeds stock when adding', () => {
    const s = run(emptyCart(), { type: 'add', productId: 'a', variantId: 'a:0', qty: 99 });
    expect(s.lines[0]!.qty).toBe(5);
    const again = run(s, { type: 'add', productId: 'a', variantId: 'a:0' });
    expect(again).toBe(s); // unchanged, same reference
  });
  it('ignores adds for sold-out or unknown variants', () => {
    expect(run(emptyCart(), { type: 'add', productId: 'b', variantId: 'b:0' }).lines).toEqual([]);
    expect(run(emptyCart(), { type: 'add', productId: 'z', variantId: 'z:9' }).lines).toEqual([]);
  });
  it('setQty clamps to stock and removes at zero', () => {
    let s = run(emptyCart(), { type: 'add', productId: 'a', variantId: 'a:0' });
    s = run(s, { type: 'setQty', variantId: 'a:0', qty: 50 });
    expect(s.lines[0]!.qty).toBe(5);
    s = run(s, { type: 'setQty', variantId: 'a:0', qty: 0 });
    expect(s.lines).toEqual([]);
  });
  it('setQty floors fractional input', () => {
    let s = run(emptyCart(), { type: 'add', productId: 'a', variantId: 'a:0' });
    s = run(s, { type: 'setQty', variantId: 'a:0', qty: 2.9 });
    expect(s.lines[0]!.qty).toBe(2);
  });
  it('remove, clear, promo and area', () => {
    let s = run(emptyCart(), { type: 'add', productId: 'a', variantId: 'a:0' }, { type: 'add', productId: 'a', variantId: 'a:1' });
    s = run(s, { type: 'remove', variantId: 'a:0' });
    expect(s.lines.map((l) => l.variantId)).toEqual(['a:1']);
    s = run(s, { type: 'applyPromo', code: ' karibu10 ' }, { type: 'setArea', areaId: 'west' });
    expect(s.promoCode).toBe('KARIBU10');
    expect(s.areaId).toBe('west');
    s = run(s, { type: 'removePromo' });
    expect(s.promoCode).toBeNull();
    s = run(s, { type: 'applyPromo', code: 'X' }, { type: 'clear' });
    expect(s.lines).toEqual([]);
    expect(s.promoCode).toBeNull();
    expect(s.areaId).toBe('west'); // delivery area is a preference, kept
  });
  it('reconcile trims quantities when stock dropped and drops sold-out lines', () => {
    const before: CartState = {
      lines: [
        { productId: 'a', variantId: 'a:0', qty: 9 },
        { productId: 'b', variantId: 'b:0', qty: 1 },
        { productId: 'a', variantId: 'a:1', qty: 1 },
      ],
      promoCode: null,
      areaId: null,
    };
    const after = run(before, { type: 'reconcile' });
    expect(after.lines).toEqual([
      { productId: 'a', variantId: 'a:0', qty: 5 },
      { productId: 'a', variantId: 'a:1', qty: 1 },
    ]);
    expect(run(after, { type: 'reconcile' })).toBe(after);
  });
  it('remainingFor counts what is left to add', () => {
    const s = run(emptyCart(), { type: 'add', productId: 'a', variantId: 'a:0', qty: 2 });
    expect(remainingFor(s, 'a:0', stock)).toBe(3);
    expect(remainingFor(s, 'a:1', stock)).toBe(1);
    expect(remainingFor(s, 'b:0', stock)).toBe(0);
  });
});
