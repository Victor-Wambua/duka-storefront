import { describe, expect, it } from 'vitest';
import { formatKES } from '../src/lib/money';
import { amountToFreeDelivery, checkPromo, discountFor, percentOf, priceOrder, subtotalOf } from '../src/lib/pricing';
import { DELIVERY_AREAS, PROMOS, estimateDelivery, getArea, nairobiHour } from '../src/data/delivery';

const area = (id: string) => getArea(id)!;
const promo = (code: string) => PROMOS.find((p) => p.code === code)!;

describe('formatKES', () => {
  it('groups thousands and never shows decimals', () => {
    expect(formatKES(0)).toBe('KES 0');
    expect(formatKES(950)).toBe('KES 950');
    expect(formatKES(1250)).toBe('KES 1,250');
    expect(formatKES(1234567)).toBe('KES 1,234,567');
    expect(formatKES(-200)).toBe('-KES 200');
  });
  it('rejects fractional shillings', () => {
    expect(() => formatKES(10.5)).toThrow(RangeError);
    expect(() => formatKES(Number.NaN)).toThrow(RangeError);
  });
});

describe('subtotalOf', () => {
  it('sums unit price x quantity', () => {
    expect(subtotalOf([{ unitPrice: 185, qty: 2 }, { unitPrice: 95, qty: 3 }])).toBe(655);
    expect(subtotalOf([])).toBe(0);
  });
  it('rejects bad quantities and prices', () => {
    expect(() => subtotalOf([{ unitPrice: 100, qty: 0 }])).toThrow(RangeError);
    expect(() => subtotalOf([{ unitPrice: 100, qty: 1.5 }])).toThrow(RangeError);
    expect(() => subtotalOf([{ unitPrice: 99.5, qty: 1 }])).toThrow(RangeError);
    expect(() => subtotalOf([{ unitPrice: -5, qty: 1 }])).toThrow(RangeError);
  });
});

describe('percentOf rounds half up on integers', () => {
  it.each([
    [1005, 10, 101], // 100.5 -> 101
    [1004, 10, 100], // 100.4 -> 100
    [995, 10, 100], // 99.5 -> 100
    [1, 10, 0],
    [5, 10, 1], // 0.5 -> 1
    [3333, 15, 500], // 499.95
  ])('%i x %i%% = %i', (amount, pct, expected) => {
    expect(percentOf(amount, pct)).toBe(expected);
  });
});

describe('promo discounts', () => {
  it('applies a percentage with a cap', () => {
    expect(discountFor(promo('KARIBU10'), 1000)).toBe(100);
    expect(discountFor(promo('KARIBU10'), 3000)).toBe(300);
    expect(discountFor(promo('KARIBU10'), 20000)).toBe(500); // capped
  });
  it('ignores a promo below its minimum', () => {
    expect(discountFor(promo('KARIBU10'), 999)).toBe(0);
    expect(discountFor(promo('JAMBO200'), 2499)).toBe(0);
  });
  it('flat discount never exceeds the subtotal', () => {
    const tiny = { ...promo('JAMBO200'), minSubtotal: 0 };
    expect(discountFor(tiny, 150)).toBe(150);
  });
  it('checkPromo normalises case and whitespace and explains failures', () => {
    expect(checkPromo('  karibu10 ', PROMOS, 1500)).toMatchObject({ ok: true });
    expect(checkPromo('NOPE', PROMOS, 1500)).toEqual({ ok: false, reason: 'unknown' });
    expect(checkPromo('', PROMOS, 1500)).toEqual({ ok: false, reason: 'empty' });
    expect(checkPromo('JAMBO200', PROMOS, 1000)).toEqual({ ok: false, reason: 'min_subtotal', minSubtotal: 2500 });
  });
});

describe('priceOrder', () => {
  const lines = (n: number) => [{ unitPrice: n, qty: 1 }];

  it('pickup is free and totals the goods', () => {
    expect(priceOrder({ lines: lines(800), area: area('pickup') })).toEqual({
      subtotal: 800, discount: 0, deliveryFee: 0, deliveryWaived: 0, total: 800,
    });
  });
  it('adds the zone fee for delivery', () => {
    expect(priceOrder({ lines: lines(800), area: area('west') })).toMatchObject({ deliveryFee: 200, total: 1000 });
  });
  it('treats no area chosen as no fee yet', () => {
    expect(priceOrder({ lines: lines(800) })).toMatchObject({ deliveryFee: 0, total: 800 });
  });
  it('free delivery kicks in at the threshold of the discounted subtotal', () => {
    // 5000 exactly: free
    expect(priceOrder({ lines: lines(5000), area: area('cbd') })).toMatchObject({ deliveryFee: 0, deliveryWaived: 150, total: 5000 });
    // 4999: paid
    expect(priceOrder({ lines: lines(4999), area: area('cbd') })).toMatchObject({ deliveryFee: 150, total: 5149 });
    // 5200 with KARIBU10 -> 4700 after discount, so delivery is charged again
    const r = priceOrder({ lines: lines(5200), promo: promo('KARIBU10'), area: area('cbd') });
    expect(r).toMatchObject({ discount: 500, deliveryFee: 150, total: 5200 - 500 + 150 });
  });
  it('free-delivery promo waives the fee only above its minimum', () => {
    expect(priceOrder({ lines: lines(1500), promo: promo('FREESHIP'), area: area('outer') })).toMatchObject({
      deliveryFee: 0, deliveryWaived: 400, total: 1500,
    });
    expect(priceOrder({ lines: lines(1499), promo: promo('FREESHIP'), area: area('outer') })).toMatchObject({
      deliveryFee: 400, total: 1899,
    });
  });
  it('total is always the integer sum of its parts', () => {
    for (const a of DELIVERY_AREAS) {
      for (const p of [null, ...PROMOS]) {
        for (const unit of [1, 99, 1001, 2499, 2500, 4999, 5000, 7777]) {
          const r = priceOrder({ lines: [{ unitPrice: unit, qty: 3 }], promo: p, area: a });
          expect(Number.isInteger(r.total)).toBe(true);
          expect(r.total).toBe(r.subtotal - r.discount + r.deliveryFee);
          expect(r.discount).toBeLessThanOrEqual(r.subtotal);
        }
      }
    }
  });
  it('amountToFreeDelivery reports the gap', () => {
    expect(amountToFreeDelivery(area('west'), 3200)).toBe(1800);
    expect(amountToFreeDelivery(area('west'), 6000)).toBe(0);
    expect(amountToFreeDelivery(area('pickup'), 100)).toBeNull();
  });
});

describe('delivery estimates (Nairobi time)', () => {
  // 09:00 EAT = 06:00 UTC
  const morning = new Date('2026-03-10T06:00:00Z');
  const evening = new Date('2026-03-10T17:30:00Z'); // 20:30 EAT
  it('converts to Nairobi hour', () => {
    expect(nairobiHour(morning)).toBe(9);
    expect(nairobiHour(evening)).toBe(20);
    expect(nairobiHour(new Date('2026-03-10T21:30:00Z'))).toBe(0);
  });
  it('same day before the cutoff, next day after', () => {
    expect(estimateDelivery(area('west'), morning)).toMatch(/today/i);
    expect(estimateDelivery(area('west'), evening)).toMatch(/tomorrow/i);
    expect(estimateDelivery(area('north'), new Date('2026-03-10T11:00:00Z'))).toMatch(/tomorrow/i); // 14:00, cutoff 13
  });
  it('outer zones take 1 to 2 days', () => {
    expect(estimateDelivery(area('outer'), morning)).toMatch(/1 to 2 days/);
  });
  it('pickup depends on shop hours', () => {
    expect(estimateDelivery(area('pickup'), morning)).toMatch(/2 hours/);
    expect(estimateDelivery(area('pickup'), evening)).toMatch(/from 10am/);
  });
});
