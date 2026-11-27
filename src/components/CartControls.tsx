import { useId, useState } from 'react';
import { DELIVERY_AREAS, PROMOS, estimateDelivery } from '../data/delivery';
import { formatKES } from '../lib/money';
import { amountToFreeDelivery, checkPromo } from '../lib/pricing';
import { useCart } from '../state/CartContext';
import type { CartView } from '../state/cartView';
import { useAnnounce } from './Announcer';

export function Stepper({
  label,
  qty,
  max,
  onChange,
}: {
  label: string;
  qty: number;
  max: number;
  onChange: (qty: number) => void;
}) {
  return (
    <div className="stepper" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" aria-label={`Decrease quantity of ${label}`} onClick={() => onChange(qty - 1)} disabled={qty <= 0}>
        <span aria-hidden="true">−</span>
      </button>
      <span className="qty num" data-testid="qty">
        {qty}
      </span>
      <button type="button" aria-label={`Increase quantity of ${label}`} onClick={() => onChange(qty + 1)} disabled={qty >= max}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

export function PromoField({ view }: { view: CartView }) {
  const { dispatch } = useCart();
  const announce = useAnnounce();
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function apply(e?: { preventDefault: () => void }) {
    e?.preventDefault();
    const res = checkPromo(code, PROMOS, view.pricing.subtotal);
    if (res.ok) {
      dispatch({ type: 'applyPromo', code: res.promo.code });
      setError(null);
      setCode('');
      announce(`Promo code ${res.promo.code} applied.`);
      return;
    }
    const msg =
      res.reason === 'empty'
        ? 'Enter a promo code.'
        : res.reason === 'unknown'
          ? 'That code is not valid. Try KARIBU10.'
          : `${code.trim().toUpperCase()} needs an order of at least ${formatKES(res.minSubtotal ?? 0)}.`;
    setError(msg);
    announce(msg);
  }

  const applied = view.promo?.ok ? view.promo.promo : null;
  const lapsed = view.promo && !view.promo.ok;

  return (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-promo`}>
        Promo code
      </label>
      {applied ? (
        <p style={{ margin: 0 }}>
          <span className="promo-chip">
            {applied.code} applied
          </span>{' '}
          <button type="button" className="link-btn" onClick={() => dispatch({ type: 'removePromo' })}>
            Remove<span className="sr-only"> promo code {applied.code}</span>
          </button>
        </p>
      ) : (
        <div className="inline-form" role="group" aria-label="Apply a promo code">
          <input
            id={`${id}-promo`}
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-promo-msg`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply(e);
            }}
          />
          <button type="button" className="btn" onClick={() => apply()}>
            Apply
          </button>
        </div>
      )}
      <span id={`${id}-promo-msg`} className={error || lapsed ? 'field__error' : 'field__hint'}>
        {error ??
          (lapsed && view.promo && !view.promo.ok
            ? `${view.promoCode ?? 'This code'} needs an order of at least ${formatKES(view.promo.minSubtotal ?? 0)}, so it is not applied.`
            : applied
              ? applied.description
              : 'Samples: KARIBU10, JAMBO200, FREESHIP')}
      </span>
    </div>
  );
}

export function DeliveryPicker({
  view,
  now = new Date(),
  selectId,
  error,
}: {
  view: CartView;
  now?: Date;
  /** Lets a form focus the select, and ties an error message to it. */
  selectId?: string;
  error?: string | undefined;
}) {
  const { dispatch } = useCart();
  const autoId = useId();
  const id = autoId;
  const areaId = selectId ?? `${id}-area`;
  const area = view.area;
  const afterDiscount = view.pricing.subtotal - view.pricing.discount;
  const gap = amountToFreeDelivery(area, afterDiscount);
  return (
    <div className="field">
      <label className="field__label" htmlFor={areaId}>
        Delivery or pickup area
      </label>
      <select
        id={areaId}
        value={area?.id ?? ''}
        onChange={(e) => dispatch({ type: 'setArea', areaId: e.target.value || null })}
        aria-describedby={error ? `${id}-err ${id}-est` : `${id}-est`}
        aria-invalid={error ? true : undefined}
      >
        <option value="">Choose your area</option>
        {DELIVERY_AREAS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.fee > 0 ? ` (KES ${a.fee})` : ''}
          </option>
        ))}
      </select>
      <span id={`${id}-est`} className="field__hint">
        {area ? (
          <>
            {estimateDelivery(area, now)}
            {gap !== null && gap > 0 && ` Add ${formatKES(gap)} more for free delivery.`}
            {area.kind === 'delivery' && gap === 0 && ' Free delivery on this order.'}
          </>
        ) : (
          'Pick an area to see the fee and estimate.'
        )}{' '}
        Sample fee table: fictional rates.
      </span>
      {error && (
        <span id={`${id}-err`} className="field__error">
          {error}
        </span>
      )}
    </div>
  );
}

export function TotalsList({ view, className }: { view: CartView; className?: string }) {
  const p = view.pricing;
  return (
    <dl className={`totals ${className ?? ''}`}>
      <div>
        <dt>Subtotal</dt>
        <dd>{formatKES(p.subtotal)}</dd>
      </div>
      {p.discount > 0 && (
        <div className="totals__discount">
          <dt>Promo {view.promo?.ok ? `(${view.promo.promo.code})` : ''}</dt>
          <dd>-{formatKES(p.discount)}</dd>
        </div>
      )}
      <div>
        <dt>Delivery</dt>
        <dd>
          {!view.area ? (
            <span style={{ fontWeight: 500 }}>Choose an area</span>
          ) : view.area.kind === 'pickup' ? (
            'Pickup, free'
          ) : p.deliveryFee === 0 ? (
            <>
              Free <s style={{ fontWeight: 400 }}>{formatKES(p.deliveryWaived)}</s>
            </>
          ) : (
            formatKES(p.deliveryFee)
          )}
        </dd>
      </div>
      <div className="totals__total">
        <dt>Total</dt>
        <dd data-testid="grand-total">{formatKES(p.total)}</dd>
      </div>
    </dl>
  );
}
