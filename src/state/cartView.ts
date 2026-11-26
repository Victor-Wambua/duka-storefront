import { getVariant } from '../data/catalogue';
import { PROMOS, getArea } from '../data/delivery';
import { checkPromo, priceOrder, subtotalOf, type PriceBreakdown, type PromoCheck } from '../lib/pricing';
import type { CartLine, DeliveryArea, Product, Variant } from '../types';
import { cartCount, type CartState, type StockFn } from './cart';

export interface CartViewLine {
  line: CartLine;
  product: Product;
  variant: Variant;
  unitPrice: number;
  lineTotal: number;
  available: number;
  atLimit: boolean;
}

export interface CartView {
  lines: CartViewLine[];
  count: number;
  pricing: PriceBreakdown;
  promo: PromoCheck | null;
  promoCode: string | null;
  area: DeliveryArea | null;
}

/** Everything the UI needs to show the cart, derived from state + stock in one pure step. */
export function buildCartView(state: CartState, stock: StockFn): CartView {
  const lines: CartViewLine[] = [];
  for (const line of state.lines) {
    const found = getVariant(line.variantId);
    if (!found) continue;
    const available = stock(line.variantId);
    lines.push({
      line,
      product: found.product,
      variant: found.variant,
      unitPrice: found.variant.price,
      lineTotal: found.variant.price * line.qty,
      available,
      atLimit: line.qty >= available,
    });
  }
  const priceLines = lines.map((l) => ({ unitPrice: l.unitPrice, qty: l.line.qty }));
  const subtotal = subtotalOf(priceLines);
  const promo = state.promoCode ? checkPromo(state.promoCode, PROMOS, subtotal) : null;
  const area = getArea(state.areaId);
  const pricing = priceOrder({ lines: priceLines, promo: promo?.ok ? promo.promo : null, area });
  return { lines, count: cartCount(state), pricing, promo, promoCode: state.promoCode, area };
}
