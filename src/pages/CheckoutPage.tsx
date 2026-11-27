import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DeliveryPicker, PromoField, TotalsList } from '../components/CartControls';
import { PageTitle } from '../components/PageTitle';
import { PaymentPanel } from '../components/PaymentPanel';
import { abandonOrder, finalizeCod, finalizePaid } from '../checkout/finalize';
import { validateCheckout, type CheckoutErrors, type CheckoutValues } from '../checkout/validate';
import { useOnline } from '../hooks/useOnline';
import { usePaymentController } from '../hooks/usePaymentController';
import { formatKES } from '../lib/money';
import { normalisePhone } from '../lib/phone';
import { mockMpesa } from '../mock/mpesaMock';
import { useCart } from '../state/CartContext';
import {
  fingerprintOf,
  newOrderRef,
  recordAttempt,
  upsertPending,
  type CheckoutSession,
  type Order,
} from '../state/orders';
import { ordersStore, sessionStore, useStore } from '../state/stores';
import type { CartView } from '../state/cartView';

const MIN_FORM: CheckoutValues = { name: '', phone: '', address: '', method: 'mpesa' };

function buildOrder(ref: string, view: CartView, v: CheckoutValues, msisdn: string): Order {
  const area = view.area!;
  return {
    ref,
    createdAt: Date.now(),
    status: 'pending_payment',
    lines: view.lines.map((l) => ({
      productId: l.product.id,
      variantId: l.variant.id,
      name: l.product.name,
      variantLabel: l.variant.label,
      unitPrice: l.unitPrice,
      qty: l.line.qty,
    })),
    pricing: view.pricing,
    promoCode: view.promo?.ok ? view.promo.promo.code : null,
    delivery: {
      areaId: area.id,
      areaName: area.name,
      kind: area.kind,
      note: area.kind === 'delivery' ? v.address.trim() : '',
    },
    customer: { name: v.name.trim(), msisdn },
    payment: { method: v.method, attempts: 0, checkoutRequestId: null, receipt: null, paidAt: null },
  };
}

export default function CheckoutPage() {
  const { view } = useCart();
  const navigate = useNavigate();
  const online = useOnline();
  const session = useStore(sessionStore);
  const orders = useStore(ordersStore);
  const uid = useId();

  const [form, setForm] = useState<CheckoutValues>(MIN_FORM);
  const [touched, setTouched] = useState<Partial<Record<keyof CheckoutValues, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [restored, setRestored] = useState(false);
  const paidRef = useRef<string | null>(null);

  const { state, controller } = usePaymentController(
    {
      service: mockMpesa,
      windowMs: () => mockMpesa.sim.get().windowSec * 1000,
      onAttempt: ({ attempt, checkoutRequestId }) => {
        const s = sessionStore.get();
        if (!s) return;
        sessionStore.set({ ...s, attempt, checkoutRequestId, requestedAt: Date.now() });
        ordersStore.set((o) => recordAttempt(o, s.orderRef, attempt, checkoutRequestId));
      },
    },
    (c) => {
      // Page reload (or coming back) while a prompt was in flight: pick up where we left off.
      const s = sessionStore.get();
      const order = s ? ordersStore.get().find((o) => o.ref === s.orderRef) : undefined;
      if (s && order && order.status === 'pending_payment' && s.checkoutRequestId && s.requestedAt) {
        c.resume({ attempt: s.attempt, orderRef: s.orderRef, checkoutRequestId: s.checkoutRequestId, startedAt: s.requestedAt });
        setRestored(true);
        setForm((f) => ({
          ...f,
          name: order.customer.name,
          phone: order.customer.msisdn,
          address: order.delivery.note,
          method: 'mpesa',
        }));
      }
    },
  );

  const busy = state.status === 'requesting' || state.status === 'awaiting_customer';
  const phone = normalisePhone(form.phone);
  const area = view.area;
  const errors: CheckoutErrors = validateCheckout(form, area);
  const showErr = (k: keyof CheckoutErrors) => (submitted || touched[k as keyof CheckoutValues] ? errors[k] : undefined);
  const order = session ? orders.find((o) => o.ref === session.orderRef) : undefined;

  // Payment confirmed: record it once, then show the receipt.
  useEffect(() => {
    if (state.status !== 'paid') return;
    // finalizePaid clears the session, so remember the ref for StrictMode's second effect run.
    const ref = sessionStore.get()?.orderRef ?? paidRef.current;
    if (!ref) return;
    paidRef.current = ref;
    finalizePaid(ref, state.receipt, state.paidAt);
    const id = window.setTimeout(() => navigate(`/order/${ref}`, { replace: true }), 1400);
    return () => window.clearTimeout(id);
  }, [state, navigate]);

  // Back to the form after a failure: put focus where the next action is.
  const prevStatus = useRef(state.status);
  useEffect(() => {
    if (prevStatus.current !== 'idle' && state.status === 'idle') {
      document.getElementById(`${uid}-phone`)?.focus();
    }
    prevStatus.current = state.status;
  }, [state.status, uid]);

  const amount = order?.pricing.total ?? view.pricing.total;
  const phoneDisplay = phone.ok ? phone.display : form.phone;

  function set<K extends keyof CheckoutValues>(k: K, v: CheckoutValues[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  const blur = (k: keyof CheckoutValues) => setTouched((t) => ({ ...t, [k]: true }));

  function sessionFor(fp: string): CheckoutSession {
    let s = sessionStore.get();
    if (s && s.fingerprint !== fp) {
      // The cart changed since the last attempt: that order is stale.
      const stale = ordersStore.get().find((o) => o.ref === s!.orderRef);
      if (stale?.status === 'pending_payment') abandonOrder(s.orderRef);
      s = null;
    }
    return s ?? { orderRef: newOrderRef(), fingerprint: fp, attempt: 0, checkoutRequestId: null, requestedAt: null };
  }

  async function startMpesa(msisdn: string) {
    const c = controller.current;
    if (!c) return;
    const fp = fingerprintOf(view.lines.map((l) => ({ variantId: l.variant.id, qty: l.line.qty })), view.promo?.ok ? view.promo.promo.code : null, area!.id, view.pricing.total);
    const s = sessionFor(fp);
    sessionStore.set(s);
    ordersStore.set((o) => upsertPending(o, buildOrder(s.orderRef, view, form, msisdn)));
    const live = ordersStore.get().find((o) => o.ref === s.orderRef)!;
    await c.pay({ orderRef: s.orderRef, attempt: s.attempt + 1, msisdn, amount: live.pricing.total });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !online) return;
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || !phone.ok || !area || view.lines.length === 0) {
      // Put focus on the first field that needs fixing; its message sits right under it.
      const order: (keyof CheckoutErrors)[] = ['name', 'phone', 'area', 'address'];
      const target = order.find((k) => errors[k]) ?? 'phone';
      requestAnimationFrame(() => document.getElementById(fieldId(target))?.focus());
      return;
    }
    if (form.method === 'mpesa') {
      void startMpesa(phone.msisdn);
    } else {
      const ref = newOrderRef();
      ordersStore.set((o) => upsertPending(o, buildOrder(ref, view, form, phone.msisdn)));
      sessionStore.set({ orderRef: ref, fingerprint: 'cod', attempt: 0, checkoutRequestId: null, requestedAt: null });
      finalizeCod(ref);
      navigate(`/order/${ref}`, { replace: true });
    }
  }

  function retry() {
    if (phone.ok) void startMpesa(phone.msisdn);
  }

  function payOnDeliveryInstead() {
    const ref = sessionStore.get()?.orderRef;
    if (!ref) return;
    controller.current?.reset();
    finalizeCod(ref);
    navigate(`/order/${ref}`, { replace: true });
  }

  function checkStatus() {
    const ref = sessionStore.get()?.orderRef;
    if (!ref || !phone.ok) return;
    void controller.current?.checkStatus({ orderRef: ref, msisdn: phone.msisdn });
  }

  const emptyCart = view.lines.length === 0;
  const showForm = state.status === 'idle';

  if (emptyCart && state.status === 'idle' && !restored) {
    return (
      <div className="empty">
        <PageTitle title="Checkout">Your cart is empty</PageTitle>
        <p>Add something from the shop before checking out.</p>
        <Link className="btn btn--primary" to="/">
          Browse the shop
        </Link>
      </div>
    );
  }

  const errorEntries = Object.entries(errors) as [keyof CheckoutErrors, string][];
  const fieldId = (k: string) => `${uid}-${k}`;
  const payLabel =
    form.method === 'mpesa'
      ? `Pay ${formatKES(view.pricing.total)} with M-Pesa`
      : area?.kind === 'pickup'
        ? 'Place order, pay at pickup'
        : 'Place order, pay on delivery';

  return (
    <>
      <PageTitle title="Checkout">Checkout</PageTitle>
      <div className="checkout">
        <div>
          {!online && showForm && (
            <p className="notice notice--warn" role="status">
              Checkout needs a connection to reach M-Pesa. Your cart is saved: reconnect and come back to this page.
            </p>
          )}

          <PaymentPanel
            state={state}
            phoneDisplay={phoneDisplay}
            amount={amount}
            orderRef={session?.orderRef ?? null}
            online={online}
            pickup={area?.kind === 'pickup'}
            onRetry={retry}
            onCancel={() => controller.current?.cancel()}
            onCheck={checkStatus}
            onChangeNumber={() => controller.current?.reset()}
            onPayOnDelivery={payOnDeliveryInstead}
          />

          <form onSubmit={onSubmit} noValidate hidden={!showForm} aria-label="Checkout details">
            {submitted && errorEntries.length > 0 && (
              <div className="error-summary" data-testid="error-summary">
                <h2>Please fix {errorEntries.length === 1 ? 'this' : `these ${errorEntries.length}`} to continue</h2>
                <ul>
                  {errorEntries.map(([k, msg]) => (
                    <li key={k}>
                      <a
                        href={`#${fieldId(k)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          document.getElementById(fieldId(k))?.focus();
                        }}
                      >
                        {msg}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <section className="panel" aria-labelledby={`${uid}-who`}>
              <h2 id={`${uid}-who`}>Your details</h2>
              <div className="field">
                <label className="field__label" htmlFor={fieldId('name')}>
                  Full name
                </label>
                <input
                  id={fieldId('name')}
                  type="text"
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  onBlur={() => blur('name')}
                  aria-invalid={showErr('name') ? true : undefined}
                  aria-describedby={showErr('name') ? `${fieldId('name')}-err` : undefined}
                />
                {showErr('name') && (
                  <span id={`${fieldId('name')}-err`} className="field__error">
                    {showErr('name')}
                  </span>
                )}
              </div>
              <div className="field">
                <label className="field__label" htmlFor={fieldId('phone')}>
                  M-Pesa phone number
                </label>
                <input
                  id={fieldId('phone')}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  onBlur={() => blur('phone')}
                  aria-invalid={showErr('phone') ? true : undefined}
                  aria-describedby={`${fieldId('phone')}-msg`}
                />
                <span id={`${fieldId('phone')}-msg`} aria-live="polite" className={phone.ok ? 'field__ok' : showErr('phone') ? 'field__error' : 'field__hint'}>
                  {phone.ok
                    ? `The prompt will go to ${phone.display} (+${phone.msisdn}).`
                    : (showErr('phone') ?? 'Use the number that has M-Pesa. Any format works: 0712 345 678, 0112 345 678 or +254 712 345 678.')}
                </span>
              </div>
            </section>

            <section className="panel" aria-labelledby={`${uid}-ship`}>
              <h2 id={`${uid}-ship`}>Delivery details</h2>
              <DeliveryPicker view={view} selectId={fieldId('area')} error={showErr('area')} />
              {area?.kind === 'delivery' && (
                <div className="field">
                  <label className="field__label" htmlFor={fieldId('address')}>
                    Address or landmark
                  </label>
                  <textarea
                    id={fieldId('address')}
                    autoComplete="street-address"
                    value={form.address}
                    onChange={(e) => set('address', e.target.value)}
                    onBlur={() => blur('address')}
                    aria-invalid={showErr('address') ? true : undefined}
                    aria-describedby={showErr('address') ? `${fieldId('address')}-err` : undefined}
                  />
                  {showErr('address') && (
                    <span id={`${fieldId('address')}-err`} className="field__error">
                      {showErr('address')}
                    </span>
                  )}
                </div>
              )}
              <PromoField view={view} />
            </section>

            <section className="panel" aria-labelledby={`${uid}-pay`}>
              <fieldset>
                <legend id={`${uid}-pay`} style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700 }}>
                  How would you like to pay?
                </legend>
                <label className="radio-card">
                  <input type="radio" name="method" checked={form.method === 'mpesa'} onChange={() => set('method', 'mpesa')} />
                  <span>
                    <strong>M-Pesa</strong>
                    <small>We send a prompt to your phone. Enter your PIN to pay. (Simulated in this demo.)</small>
                  </span>
                </label>
                <label className="radio-card">
                  <input type="radio" name="method" checked={form.method === 'cod'} onChange={() => set('method', 'cod')} />
                  <span>
                    <strong>{area?.kind === 'pickup' ? 'Pay at pickup' : 'Pay on delivery'}</strong>
                    <small>Pay the rider or the shop when you receive your order.</small>
                  </span>
                </label>
              </fieldset>
              <button type="submit" className="btn btn--primary btn--block" disabled={!online || busy}>
                {payLabel}
              </button>
              {!online && (
                <p className="field__hint" style={{ marginTop: 'var(--s-2)' }}>
                  Offline: reconnect to pay.
                </p>
              )}
              <p className="sample-note" style={{ marginTop: 'var(--s-3)', marginBottom: 0 }}>
                Demo only: no money moves, whichever option you choose.
              </p>
            </section>
          </form>
        </div>

        <aside className="checkout__summary panel" aria-labelledby={`${uid}-sum`}>
          <h2 id={`${uid}-sum`}>Order summary</h2>
          <ul className="lines" aria-label="Items in this order">
            {(order && busy ? order.lines.map((l) => ({ k: l.variantId, name: l.name, variant: l.variantLabel, qty: l.qty, total: l.unitPrice * l.qty })) : view.lines.map((l) => ({ k: l.variant.id, name: l.product.name, variant: l.variant.label, qty: l.line.qty, total: l.lineTotal }))).map((l) => (
              <li key={l.k} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: 'var(--fs-sm)' }}>
                <span>
                  {l.qty} × {l.name} <span style={{ color: 'var(--text-muted)' }}>({l.variant})</span>
                </span>
                <span className="num">{formatKES(l.total)}</span>
              </li>
            ))}
          </ul>
          {order && busy ? (
            <TotalsList
              view={{ ...view, pricing: order.pricing, promo: view.promo }}
            />
          ) : (
            <TotalsList view={view} />
          )}
        </aside>
      </div>
    </>
  );
}
