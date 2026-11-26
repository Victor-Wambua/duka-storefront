import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAnnounce } from '../components/Announcer';
import { formatKES } from '../lib/money';
import type { Product, Variant } from '../types';
import { cartReducer, remainingFor, type CartAction } from './cart';
import { buildCartView, type CartView } from './cartView';
import { cartStore, inventoryStore, stockOf, useStore } from './stores';

interface CartApi {
  view: CartView;
  stock: (variantId: string) => number;
  add: (product: Product, variant: Variant, qty?: number) => { added: number; limited: boolean };
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  dispatch: (a: CartAction) => void;
  drawerOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
}

const Ctx = createContext<CartApi | null>(null);

export function useCart(): CartApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart outside CartProvider');
  return v;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const state = useStore(cartStore);
  const inv = useStore(inventoryStore);
  const announce = useAnnounce();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const stock = useCallback((id: string) => stockOf(id, inv), [inv]);
  const view = useMemo(() => buildCartView(state, stock), [state, stock]);

  // Keep the saved cart honest when stock changes (a purchase elsewhere, a reload).
  useEffect(() => {
    cartStore.set((s) => cartReducer(s, { type: 'reconcile' }, (id) => stockOf(id)));
  }, [inv]);

  const dispatch = useCallback((a: CartAction) => {
    cartStore.set((s) => cartReducer(s, a, (id) => stockOf(id)));
  }, []);

  const add = useCallback<CartApi['add']>(
    (product, variant, qty = 1) => {
      const room = remainingFor(cartStore.get(), variant.id, (id) => stockOf(id));
      const added = Math.min(qty, room);
      const name = `${product.name}, ${variant.label}`;
      if (added < 1) {
        announce(`${name}: you already have all ${stockOf(variant.id)} that we have in stock.`);
        return { added: 0, limited: true };
      }
      dispatch({ type: 'add', productId: product.id, variantId: variant.id, qty: added });
      const after = buildCartView(cartStore.get(), (id) => stockOf(id));
      const limited = added < qty;
      announce(
        `${added > 1 ? `${added} x ` : ''}${name} added to cart${limited ? ` (only ${added} more were available)` : ''}. ` +
          `Cart: ${after.count} ${after.count === 1 ? 'item' : 'items'}, ${formatKES(after.pricing.subtotal)}.`,
      );
      return { added, limited };
    },
    [announce, dispatch],
  );

  const setQty = useCallback(
    (variantId: string, qty: number) => {
      const before = cartStore.get().lines.find((l) => l.variantId === variantId)?.qty ?? 0;
      dispatch({ type: 'setQty', variantId, qty });
      const after = cartStore.get().lines.find((l) => l.variantId === variantId)?.qty ?? 0;
      if (after < qty && after > 0 && after === before) announce(`Only ${after} in stock.`);
      else announce(after === 0 ? 'Item removed from cart.' : `Quantity ${after}.`);
    },
    [announce, dispatch],
  );

  const remove = useCallback(
    (variantId: string) => {
      dispatch({ type: 'remove', variantId });
      announce('Item removed from cart.');
    },
    [announce, dispatch],
  );

  const value = useMemo<CartApi>(
    () => ({
      view,
      stock,
      add,
      setQty,
      remove,
      dispatch,
      drawerOpen,
      openCart: () => setDrawerOpen(true),
      closeCart: () => setDrawerOpen(false),
    }),
    [view, stock, add, setQty, remove, dispatch, drawerOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
