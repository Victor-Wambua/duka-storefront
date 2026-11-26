import type { CartLine } from '../types';
import type { StoreSpec } from '../lib/persist';

export interface CartState {
  lines: CartLine[];
  promoCode: string | null;
  areaId: string | null;
}

export type StockFn = (variantId: string) => number;

export type CartAction =
  | { type: 'add'; productId: string; variantId: string; qty?: number }
  | { type: 'setQty'; variantId: string; qty: number }
  | { type: 'remove'; variantId: string }
  | { type: 'clear' }
  | { type: 'applyPromo'; code: string }
  | { type: 'removePromo' }
  | { type: 'setArea'; areaId: string | null }
  | { type: 'reconcile' };

export const emptyCart = (): CartState => ({ lines: [], promoCode: null, areaId: null });

const clamp = (qty: number, max: number) => Math.max(0, Math.min(Math.floor(qty), max));

/** Pure reducer. `stock` is passed in so limits are enforced in one place. */
export function cartReducer(state: CartState, action: CartAction, stock: StockFn): CartState {
  switch (action.type) {
    case 'add': {
      const max = stock(action.variantId);
      const existing = state.lines.find((l) => l.variantId === action.variantId);
      const want = (existing?.qty ?? 0) + (action.qty ?? 1);
      const qty = clamp(want, max);
      if (qty < 1) return state;
      if (existing) {
        if (existing.qty === qty) return state;
        return { ...state, lines: state.lines.map((l) => (l.variantId === action.variantId ? { ...l, qty } : l)) };
      }
      return { ...state, lines: [...state.lines, { productId: action.productId, variantId: action.variantId, qty }] };
    }
    case 'setQty': {
      const qty = clamp(action.qty, stock(action.variantId));
      if (qty < 1) return { ...state, lines: state.lines.filter((l) => l.variantId !== action.variantId) };
      return { ...state, lines: state.lines.map((l) => (l.variantId === action.variantId ? { ...l, qty } : l)) };
    }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.variantId !== action.variantId) };
    case 'clear':
      return { ...state, lines: [], promoCode: null };
    case 'applyPromo':
      return { ...state, promoCode: action.code.trim().toUpperCase() || null };
    case 'removePromo':
      return { ...state, promoCode: null };
    case 'setArea':
      return { ...state, areaId: action.areaId };
    case 'reconcile': {
      const lines: CartLine[] = [];
      for (const l of state.lines) {
        const qty = clamp(l.qty, stock(l.variantId));
        if (qty >= 1) lines.push(qty === l.qty ? l : { ...l, qty });
      }
      const same = lines.length === state.lines.length && lines.every((l, i) => l === state.lines[i]);
      return same ? state : { ...state, lines };
    }
  }
}

export const cartCount = (s: CartState) => s.lines.reduce((n, l) => n + l.qty, 0);

/** How many more of a variant can be added right now. */
export function remainingFor(state: CartState, variantId: string, stock: StockFn): number {
  const inCart = state.lines.find((l) => l.variantId === variantId)?.qty ?? 0;
  return Math.max(0, stock(variantId) - inCart);
}

// ---- persistence ----

export const CART_VERSION = 2;

function isLine(x: unknown): x is CartLine {
  if (typeof x !== 'object' || x === null) return false;
  const l = x as Record<string, unknown>;
  return (
    typeof l.productId === 'string' &&
    typeof l.variantId === 'string' &&
    typeof l.qty === 'number' &&
    Number.isInteger(l.qty) &&
    l.qty >= 1
  );
}

export const cartSpec: StoreSpec<CartState> = {
  key: 'duka.cart',
  version: CART_VERSION,
  initial: emptyCart,
  migrations: {
    // v1: { items: [{ variantId, qty }], promo?: string }  (no product id, no delivery area)
    1: (data) => {
      const d = (data ?? {}) as { items?: { variantId?: unknown; qty?: unknown }[]; promo?: unknown };
      const lines = (Array.isArray(d.items) ? d.items : [])
        .filter((i) => typeof i === 'object' && i !== null && typeof i.variantId === 'string' && typeof i.qty === 'number')
        .map((i) => ({
          productId: String(i.variantId).split(':')[0]!,
          variantId: String(i.variantId),
          qty: Math.floor(Number(i.qty)),
        }));
      return { lines, promoCode: typeof d.promo === 'string' ? d.promo : null, areaId: null };
    },
  },
  validate: (data) => {
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.lines)) return null;
    return {
      lines: d.lines.filter(isLine),
      promoCode: typeof d.promoCode === 'string' ? d.promoCode : null,
      areaId: typeof d.areaId === 'string' ? d.areaId : null,
    };
  },
};
