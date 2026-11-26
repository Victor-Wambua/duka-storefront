import type { DeliveryArea, Promo } from '../types';

/** SAMPLE fee table. Fictional values for the demo, not a real courier's rates. */
export const DELIVERY_AREAS: DeliveryArea[] = [
  { id: 'pickup', name: 'Pick up at the shop (free)', fee: 0, kind: 'pickup', freeOver: null, sameDayCutoff: null },
  { id: 'cbd', name: 'CBD & Upper Hill', fee: 150, kind: 'delivery', freeOver: 5000, sameDayCutoff: 15 },
  { id: 'west', name: 'Westlands, Kilimani & Lavington', fee: 200, kind: 'delivery', freeOver: 5000, sameDayCutoff: 15 },
  { id: 'south', name: 'South B, South C & Langata', fee: 250, kind: 'delivery', freeOver: 5000, sameDayCutoff: 14 },
  { id: 'east', name: 'Umoja, Donholm & Buruburu', fee: 250, kind: 'delivery', freeOver: 5000, sameDayCutoff: 14 },
  { id: 'north', name: 'Roysambu, Kasarani & Ruaka', fee: 300, kind: 'delivery', freeOver: 6000, sameDayCutoff: 13 },
  { id: 'outer', name: 'Rongai, Kitengela & Ngong', fee: 400, kind: 'delivery', freeOver: 7000, sameDayCutoff: null },
];

export const SHOP_HOURS = { open: 8, close: 20 } as const;

export function getArea(id: string | null | undefined): DeliveryArea | null {
  return DELIVERY_AREAS.find((a) => a.id === id) ?? null;
}

/** Nairobi is UTC+3 all year; no DST to worry about. */
export function nairobiHour(now: Date): number {
  return (now.getUTCHours() + 3) % 24;
}

export function estimateDelivery(area: DeliveryArea, now: Date): string {
  const h = nairobiHour(now);
  if (area.kind === 'pickup') {
    if (h >= SHOP_HOURS.open && h < SHOP_HOURS.close - 2) return 'Ready to collect in about 2 hours.';
    if (h >= SHOP_HOURS.open && h < SHOP_HOURS.close) return 'Ready to collect before closing at 8pm.';
    return 'Ready to collect from 10am (the shop opens at 8am).';
  }
  if (area.sameDayCutoff !== null && h >= SHOP_HOURS.open && h < area.sameDayCutoff) {
    return 'Delivered today, between 4pm and 8pm.';
  }
  if (area.sameDayCutoff === null) return 'Delivered in 1 to 2 days, 9am to 1pm.';
  return 'Delivered tomorrow, 9am to 1pm.';
}

/** SAMPLE promo codes, shown on the page so reviewers can try them. */
export const PROMOS: Promo[] = [
  { code: 'KARIBU10', kind: 'percent', value: 10, minSubtotal: 1000, maxDiscount: 500, description: '10% off, up to KES 500, on orders from KES 1,000' },
  { code: 'JAMBO200', kind: 'flat', value: 200, minSubtotal: 2500, description: 'KES 200 off orders from KES 2,500' },
  { code: 'FREESHIP', kind: 'free_delivery', value: 0, minSubtotal: 1500, description: 'Free delivery on orders from KES 1,500' },
];
