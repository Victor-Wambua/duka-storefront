import { cartStore, ordersStore, sellLines, sessionStore } from '../state/stores';
import { cancelOrder, confirmCod, markPaid, type Order } from '../state/orders';

function forgetSession(ref: string): void {
  if (sessionStore.get()?.orderRef !== ref) return;
  sessionStore.set(null);
  cartStore.set((c) => ({ ...c, lines: [], promoCode: null }));
}

const find = (ref: string): Order | undefined => ordersStore.get().find((o) => o.ref === ref);

/**
 * Record a confirmed payment. Safe to call more than once for the same order
 * (page reload, lookup, late callback): only the first call changes anything,
 * so stock is never sold twice.
 */
export function finalizePaid(ref: string, receipt: string, paidAt: number): void {
  const order = find(ref);
  if (!order || order.status === 'paid') return;
  const wasPending = order.status === 'pending_payment';
  ordersStore.set((o) => markPaid(o, ref, receipt, paidAt));
  if (wasPending) sellLines(order.lines);
  forgetSession(ref);
}

/** Confirm an order as pay-on-delivery (or pay-at-pickup). */
export function finalizeCod(ref: string): void {
  const order = find(ref);
  if (!order || order.status !== 'pending_payment') return;
  ordersStore.set((o) => confirmCod(o, ref));
  sellLines(order.lines);
  forgetSession(ref);
}

export function abandonOrder(ref: string): void {
  ordersStore.set((o) => cancelOrder(o, ref));
  if (sessionStore.get()?.orderRef === ref) sessionStore.set(null);
}
