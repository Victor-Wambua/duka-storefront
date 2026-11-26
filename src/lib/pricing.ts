import type { DeliveryArea, Promo } from '../types';
import { assertShillings } from './money';

export interface PriceLine {
  unitPrice: number;
  qty: number;
}

export interface PriceBreakdown {
  subtotal: number;
  /** promo discount on goods */
  discount: number;
  /** delivery fee actually charged */
  deliveryFee: number;
  /** delivery fee waived (threshold or promo), for display */
  deliveryWaived: number;
  total: number;
}

export type PromoCheck =
  | { ok: true; promo: Promo }
  | { ok: false; reason: 'unknown' | 'min_subtotal' | 'empty'; minSubtotal?: number };

export function subtotalOf(lines: PriceLine[]): number {
  let sum = 0;
  for (const l of lines) {
    assertShillings(l.unitPrice, 'unit price');
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) throw new RangeError(`quantity must be a positive integer, got ${l.qty}`);
    if (l.unitPrice < 0) throw new RangeError('unit price cannot be negative');
    sum += l.unitPrice * l.qty;
  }
  return sum;
}

/** Percentage of an integer, rounded half up, using integer arithmetic only. */
export function percentOf(amount: number, percent: number): number {
  return Math.floor((amount * percent + 50) / 100);
}

export function discountFor(promo: Promo | null | undefined, subtotal: number): number {
  if (!promo || subtotal < promo.minSubtotal) return 0;
  let d = 0;
  if (promo.kind === 'percent') {
    d = percentOf(subtotal, promo.value);
    if (promo.maxDiscount !== undefined) d = Math.min(d, promo.maxDiscount);
  } else if (promo.kind === 'flat') {
    d = promo.value;
  }
  return Math.min(Math.max(d, 0), subtotal);
}

export function checkPromo(code: string, promos: Promo[], subtotal: number): PromoCheck {
  const c = code.trim().toUpperCase();
  if (c === '') return { ok: false, reason: 'empty' };
  const promo = promos.find((p) => p.code === c);
  if (!promo) return { ok: false, reason: 'unknown' };
  if (subtotal < promo.minSubtotal) return { ok: false, reason: 'min_subtotal', minSubtotal: promo.minSubtotal };
  return { ok: true, promo };
}

export function deliveryFeeFor(area: DeliveryArea | null | undefined, discountedSubtotal: number, freeDeliveryPromo = false) {
  if (!area || area.kind === 'pickup') return { fee: 0, waived: 0 };
  const free = freeDeliveryPromo || (area.freeOver !== null && discountedSubtotal >= area.freeOver);
  return free ? { fee: 0, waived: area.fee } : { fee: area.fee, waived: 0 };
}

/**
 * Order of operations: subtotal -> promo discount -> delivery (free over a
 * threshold of the *discounted* subtotal, or by promo) -> total.
 * Every value is an integer number of shillings.
 */
export function priceOrder(input: {
  lines: PriceLine[];
  promo?: Promo | null;
  area?: DeliveryArea | null;
}): PriceBreakdown {
  const subtotal = subtotalOf(input.lines);
  const promoActive = !!input.promo && subtotal >= input.promo.minSubtotal;
  const discount = discountFor(input.promo, subtotal);
  const { fee, waived } = deliveryFeeFor(
    input.area,
    subtotal - discount,
    promoActive && input.promo?.kind === 'free_delivery',
  );
  return { subtotal, discount, deliveryFee: fee, deliveryWaived: waived, total: subtotal - discount + fee };
}

export function amountToFreeDelivery(area: DeliveryArea | null | undefined, discountedSubtotal: number): number | null {
  if (!area || area.kind === 'pickup' || area.freeOver === null) return null;
  return Math.max(0, area.freeOver - discountedSubtotal);
}
