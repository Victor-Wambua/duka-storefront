export type CategoryId = 'pantry' | 'drinks' | 'cleaning' | 'kitchen' | 'home' | 'care';

export interface Category {
  id: CategoryId;
  name: string;
}

export type ArtShape =
  | 'bag'
  | 'bottle'
  | 'tin'
  | 'box'
  | 'carton'
  | 'jar'
  | 'tube'
  | 'soap'
  | 'roll'
  | 'pot'
  | 'bucket'
  | 'mug'
  | 'plates'
  | 'spoon'
  | 'flask'
  | 'basket'
  | 'textile';

export interface ArtSpec {
  shape: ArtShape;
  /** main body colour, darker shade, accent */
  colors: [string, string, string];
  label?: string;
  sublabel?: string;
}

export interface Variant {
  id: string;
  label: string;
  /** integer Kenyan shillings */
  price: number;
  /** units on the shelf at the start of the demo */
  stock: number;
  /** optional body colour override for colour variants */
  tint?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: CategoryId;
  blurb: string;
  description: string;
  variantKind: 'Size' | 'Colour' | 'Pack';
  variants: Variant[];
  art: ArtSpec;
  tags: string[];
  badge?: 'New' | 'Popular';
}

export interface CartLine {
  productId: string;
  variantId: string;
  qty: number;
}

export interface DeliveryArea {
  id: string;
  name: string;
  /** integer shillings; 0 for pickup */
  fee: number;
  kind: 'pickup' | 'delivery';
  /** orders at or above this subtotal (after discount) ship free; null = never */
  freeOver: number | null;
  /** Nairobi-local hour (0-23) before which an order can go out the same day */
  sameDayCutoff: number | null;
}

export type PromoKind = 'percent' | 'flat' | 'free_delivery';

export interface Promo {
  code: string;
  kind: PromoKind;
  /** percent (1-100) or flat shillings; unused for free_delivery */
  value: number;
  minSubtotal: number;
  /** cap on a percentage discount, in shillings */
  maxDiscount?: number;
  description: string;
}
