import { normalisePhone, phoneMessage } from '../lib/phone';
import type { DeliveryArea } from '../types';

export interface CheckoutValues {
  name: string;
  phone: string;
  address: string;
  method: 'mpesa' | 'cod';
}

export type CheckoutErrors = Partial<Record<'name' | 'phone' | 'address' | 'area', string>>;

export function validateCheckout(v: CheckoutValues, area: DeliveryArea | null): CheckoutErrors {
  const e: CheckoutErrors = {};
  if (v.name.trim().length < 2) e.name = 'Enter your name so we know who the order is for.';
  const phone = normalisePhone(v.phone);
  if (!phone.ok) e.phone = phoneMessage(phone.reason);
  if (!area) e.area = 'Choose delivery or pickup.';
  else if (area.kind === 'delivery' && v.address.trim().length < 5) {
    e.address = 'Enter a street, estate or landmark so the rider can find you.';
  }
  return e;
}
