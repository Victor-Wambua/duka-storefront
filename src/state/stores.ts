import { useSyncExternalStore } from 'react';
import { createStore, type Store } from '../lib/persist';
import { getVariant } from '../data/catalogue';
import { cartSpec, type CartState } from './cart';
import { inventorySpec, ordersSpec, sessionSpec, type CheckoutSession, type Inventory, type Order } from './orders';

export const cartStore = createStore<CartState>(cartSpec);
export const ordersStore = createStore<Order[]>(ordersSpec);
export const sessionStore = createStore<CheckoutSession | null>(sessionSpec);
export const inventoryStore = createStore<Inventory>(inventorySpec);

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Units currently available: shelf stock minus what this demo has already sold. */
export function stockOf(variantId: string, inv: Inventory = inventoryStore.get()): number {
  const v = getVariant(variantId);
  if (!v) return 0;
  return Math.max(0, v.variant.stock - (inv.sold[variantId] ?? 0));
}

export function sellLines(lines: { variantId: string; qty: number }[]): void {
  inventoryStore.set((inv) => {
    const sold = { ...inv.sold };
    for (const l of lines) sold[l.variantId] = (sold[l.variantId] ?? 0) + l.qty;
    return { sold };
  });
}

export function resetDemoData(): void {
  cartStore.set(cartSpec.initial());
  ordersStore.set([]);
  sessionStore.set(null);
  inventoryStore.set(inventorySpec.initial());
}
