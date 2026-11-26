import type { StoreSpec } from '../lib/persist';
import type { PriceBreakdown } from '../lib/pricing';

export type OrderStatus = 'pending_payment' | 'paid' | 'pay_on_delivery' | 'cancelled';

export interface OrderLine {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
}

export interface Order {
  ref: string;
  createdAt: number;
  status: OrderStatus;
  lines: OrderLine[];
  pricing: PriceBreakdown;
  promoCode: string | null;
  delivery: { areaId: string; areaName: string; kind: 'pickup' | 'delivery'; note: string };
  customer: { name: string; msisdn: string };
  payment: {
    method: 'mpesa' | 'cod';
    attempts: number;
    checkoutRequestId: string | null;
    receipt: string | null;
    paidAt: number | null;
  };
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newOrderRef(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'DUKA-' + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

export function normaliseRef(input: string): string {
  const c = input.trim().toUpperCase().replace(/\s+/g, '');
  return c.startsWith('DUKA') && !c.startsWith('DUKA-') ? `DUKA-${c.slice(4)}` : c;
}

// ---- pure helpers over the list ----

export function upsertPending(orders: Order[], order: Order): Order[] {
  // Idempotent: an order ref is only ever created once. If it already exists and is
  // still unpaid, a retry may change who is paying (phone number) and where to deliver.
  const existing = orders.find((o) => o.ref === order.ref);
  if (!existing) return [order, ...orders];
  if (existing.status !== 'pending_payment') return orders;
  return orders.map((o) =>
    o.ref === order.ref ? { ...o, customer: order.customer, delivery: order.delivery } : o,
  );
}

const update = (orders: Order[], ref: string, fn: (o: Order) => Order) =>
  orders.map((o) => (o.ref === ref ? fn(o) : o));

export const recordAttempt = (orders: Order[], ref: string, attempt: number, checkoutRequestId: string | null) =>
  update(orders, ref, (o) =>
    o.status === 'pending_payment'
      ? { ...o, payment: { ...o.payment, attempts: Math.max(o.payment.attempts, attempt), checkoutRequestId } }
      : o,
  );

export const markPaid = (orders: Order[], ref: string, receipt: string, paidAt: number) =>
  update(orders, ref, (o) =>
    o.status === 'paid' ? o : { ...o, status: 'paid', payment: { ...o.payment, receipt, paidAt } },
  );

export const confirmCod = (orders: Order[], ref: string) =>
  update(orders, ref, (o) => (o.status === 'pending_payment' ? { ...o, status: 'pay_on_delivery' } : o));

export const cancelOrder = (orders: Order[], ref: string) =>
  update(orders, ref, (o) => (o.status === 'pending_payment' ? { ...o, status: 'cancelled' } : o));

// ---- persistence ----

export const ORDERS_VERSION = 1;

export const ordersSpec: StoreSpec<Order[]> = {
  key: 'duka.orders',
  version: ORDERS_VERSION,
  initial: () => [],
  validate: (data) =>
    Array.isArray(data)
      ? (data.filter(
          (o) => typeof o === 'object' && o !== null && typeof (o as Order).ref === 'string' && Array.isArray((o as Order).lines),
        ) as Order[])
      : null,
};

// ---- checkout session: one order ref per cart, many attempts ----

export interface CheckoutSession {
  orderRef: string;
  fingerprint: string;
  /** number of STK push attempts made for this order */
  attempt: number;
  checkoutRequestId: string | null;
  requestedAt: number | null;
}

export const sessionSpec: StoreSpec<CheckoutSession | null> = {
  key: 'duka.checkout',
  version: 1,
  initial: () => null,
  validate: (d) =>
    d === null || (typeof d === 'object' && typeof (d as CheckoutSession).orderRef === 'string')
      ? (d as CheckoutSession | null)
      : null,
};

export function fingerprintOf(lines: { variantId: string; qty: number }[], promo: string | null, areaId: string | null, total: number): string {
  return JSON.stringify([lines.map((l) => [l.variantId, l.qty]), promo, areaId, total]);
}

// ---- inventory ledger: what the demo shop has sold ----

export interface Inventory {
  sold: Record<string, number>;
}

export const inventorySpec: StoreSpec<Inventory> = {
  key: 'duka.inventory',
  version: 1,
  initial: () => ({ sold: {} }),
  validate: (d) =>
    typeof d === 'object' && d !== null && typeof (d as Inventory).sold === 'object' && (d as Inventory).sold !== null
      ? (d as Inventory)
      : null,
};
