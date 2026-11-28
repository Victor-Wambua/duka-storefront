import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageTitle } from '../components/PageTitle';
import { PrintIcon } from '../components/Icons';
import { finalizePaid } from '../checkout/finalize';
import { formatKES } from '../lib/money';
import { maskPhone } from '../lib/phone';
import { INSPECTOR_URL, SANDBOX_INSPECTOR_URL } from '../gateway/config';
import { SANDBOX_CHARGE_KES, standInNote } from '../gateway/sandbox';
import { useOnline } from '../hooks/useOnline';
import { paymentService } from '../payment/instance';
import { normaliseRef, setUnderReview, type Order } from '../state/orders';
import { ordersStore, useStore } from '../state/stores';
import NotFound from './NotFound';

export function StatusBadge({ order }: { order: Order }) {
  const map = {
    paid: ['status-badge--paid', order.payment.provider === 'sandbox' ? 'Paid (sandbox test)' : 'Paid'],
    pay_on_delivery: ['status-badge--cod', order.delivery.kind === 'pickup' ? 'Pay at pickup' : 'Pay on delivery'],
    pending_payment: ['status-badge--pending', order.payment.underReview ? 'Payment under review' : 'Awaiting payment'],
    cancelled: ['status-badge--cancelled', 'Cancelled'],
  } as const;
  const [cls, label] = map[order.status];
  return <span className={`status-badge ${cls}`}>{label}</span>;
}

export default function OrderPage() {
  const { ref = '' } = useParams();
  const orders = useStore(ordersStore);
  const order = orders.find((o) => o.ref === normaliseRef(ref));
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const online = useOnline();
  const autoChecked = useRef<string | null>(null);
  const viaSandbox = order?.payment.provider === 'sandbox';
  /** either deployed gateway instance (mock Daraja or Safaricom sandbox) */
  const viaGateway = order?.payment.provider === 'gateway' || viaSandbox;

  async function check(o: Order) {
    setChecking(true);
    setMessage(null);
    try {
      const res = await paymentService.lookupPayment({
        orderRef: o.ref,
        msisdn: o.customer.msisdn,
        provider: o.payment.provider ?? 'simulator',
        amount: o.pricing.total,
      });
      ordersStore.set((all) => setUnderReview(all, o.ref, res.state === 'review'));
      if (res.state === 'paid') {
        finalizePaid(o.ref, res.receipt, res.paidAt);
        setMessage('Payment found. Your order is now marked as paid.');
      } else if (res.state === 'pending') {
        setMessage('Still processing. Check again in a minute. Do not pay twice.');
      } else if (res.state === 'review') {
        setMessage('The gateway is still holding this payment for review. Your order is not marked as paid. Please do not pay again yet.');
      } else if (res.state === 'failed') {
        setMessage('The last payment attempt for this order did not go through, so nothing is marked as paid. You can place the order again from checkout or choose pay on delivery.');
      } else {
        setMessage('No payment found yet for this order.');
      }
    } catch {
      setMessage('We could not check just now. Try again when you are online.');
    } finally {
      setChecking(false);
    }
  }

  // A gateway order that is not paid yet: ask the gateway once when the page opens.
  useEffect(() => {
    if (!order || order.status !== 'pending_payment' || !viaGateway || !online) return;
    if (autoChecked.current === order.ref) return;
    autoChecked.current = order.ref;
    void check(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.ref, order?.status, viaGateway, online]);

  if (!order) return <NotFound what="order" />;

  const p = order.pricing;
  const inspectorUrl = viaSandbox ? SANDBOX_INSPECTOR_URL : INSPECTOR_URL;
  const standIn = viaSandbox ? standInNote(p.total) : null;
  const when = new Date(order.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <div className="no-print">
        <PageTitle title={`Order ${order.ref}`}>
          {order.status === 'paid' || order.status === 'pay_on_delivery' ? 'Thank you, your order is in' : `Order ${order.ref}`}
        </PageTitle>
      </div>

      {order.status === 'pending_payment' && (
        <div className="notice notice--warn no-print" role="status">
          {order.payment.underReview ? (
            <p>
              <strong>Payment under review.</strong> The gateway is holding this payment instead of marking it paid, so this order is
              not paid. The payment may still complete: please do not pay again yet.
            </p>
          ) : (
            <p>
              <strong>Payment not confirmed yet.</strong> If you approved the M-Pesa prompt, it may still be processing.
            </p>
          )}
          <button type="button" className="btn btn--sm" onClick={() => void check(order)} disabled={checking}>
            {checking ? 'Checking…' : 'Check payment status'}
          </button>
        </div>
      )}
      {message && (
        <p className="notice notice--info no-print" role="status">
          {message}
        </p>
      )}

      <article className="panel receipt" aria-label={`Receipt for order ${order.ref}`}>
        <div className="receipt__head">
          <div>
            <h2 style={{ marginBottom: 'var(--s-1)' }}>Receipt {order.ref}</h2>
            <p className="receipt__shop">Mama Lucy&rsquo;s Provisions &amp; Homeware (fictional demo shop)</p>
          </div>
          <StatusBadge order={order} />
        </div>

        <dl className="receipt__grid">
          <div>
            <dt>Placed</dt>
            <dd>{when}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>
              {order.customer.name}
              <br />
              <span className="num">{maskPhone(order.customer.msisdn)}</span>
            </dd>
          </div>
          <div>
            <dt>{order.delivery.kind === 'pickup' ? 'Pickup' : 'Delivery'}</dt>
            <dd>
              {order.delivery.areaName}
              {order.delivery.note && (
                <>
                  <br />
                  {order.delivery.note}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>
              {order.payment.method === 'mpesa'
                ? viaSandbox
                  ? `M-Pesa through the Safaricom sandbox (real prompt, ${formatKES(order.payment.chargedKes ?? SANDBOX_CHARGE_KES)} test charge)`
                  : viaGateway
                    ? 'M-Pesa through the demo gateway (mock Daraja)'
                    : 'M-Pesa (simulated)'
                : order.delivery.kind === 'pickup'
                  ? 'Pay at pickup'
                  : 'Pay on delivery'}
              {order.payment.receipt && (
                <>
                  <br />
                  Receipt <span data-testid="mpesa-receipt">{order.payment.receipt}</span>
                </>
              )}
              {order.payment.method === 'mpesa' && viaGateway && order.payment.gatewayPaymentId && (
                <>
                  <br />
                  <span className="receipt__gw">
                    Gateway payment <span className="num" data-testid="gateway-payment-id">{order.payment.gatewayPaymentId}</span>
                    {order.payment.darajaCheckoutId && (
                      <>
                        <br />
                        CheckoutRequestID <span className="num" data-testid="gateway-checkout-id">{order.payment.darajaCheckoutId}</span>
                      </>
                    )}
                    <span className="no-print">
                      <br />
                      <a href={inspectorUrl} target="_blank" rel="noopener noreferrer">
                        Inspect this payment<span className="sr-only"> (opens the gateway inspector in a new tab)</span>
                      </a>{' '}
                      (find it under Recent payments)
                    </span>
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>

        <table>
          <caption className="sr-only">Items in order {order.ref}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.variantId}>
                <td>
                  {l.name} <span style={{ color: 'var(--text-muted)' }}>({l.variantLabel})</span>
                </td>
                <td className="num">{l.qty}</td>
                <td className="num">{formatKES(l.unitPrice)}</td>
                <td className="num">{formatKES(l.unitPrice * l.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {standIn && (
          <p className="notice notice--info" data-testid="stand-in-note" style={{ marginTop: 'var(--s-4)' }}>
            {standIn}.{order.status === 'paid' ? ' The gateway reported the test charge as succeeded.' : ''}
          </p>
        )}

        <dl className="totals" style={{ marginTop: 'var(--s-4)', maxWidth: '20rem', marginLeft: 'auto' }}>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatKES(p.subtotal)}</dd>
          </div>
          {p.discount > 0 && (
            <div className="totals__discount">
              <dt>Promo {order.promoCode ? `(${order.promoCode})` : ''}</dt>
              <dd>-{formatKES(p.discount)}</dd>
            </div>
          )}
          <div>
            <dt>Delivery</dt>
            <dd>{p.deliveryFee === 0 ? 'Free' : formatKES(p.deliveryFee)}</dd>
          </div>
          <div className="totals__total">
            <dt>{order.status === 'paid' && !viaSandbox ? 'Total paid' : 'Total'}</dt>
            <dd>{formatKES(p.total)}</dd>
          </div>
        </dl>

        <p className="receipt__sim">
          {viaSandbox ? (
            <>
              This is a demonstration receipt. The shop and items are invented and nothing will be delivered. The payment went
              through Safaricom&rsquo;s Daraja sandbox, which is not simulated, and only a flat KES 1 test charge was sent, never the
              order total. What a sandbox success does, including whether it could debit a real wallet, has not been verified, so
              check your own M-Pesa messages.
            </>
          ) : viaGateway ? (
            <>
              This is a demonstration receipt. The shop and items are invented. The payment went through a live sandbox gateway whose
              Daraja side is a mock, so no money was charged. Receipt codes starting with MOCK are synthetic.
            </>
          ) : (
            <>
              This is a demonstration receipt. The shop, items and payment are simulated and no money was charged. Receipt codes
              starting with SIM are generated by the in-browser mock.
            </>
          )}
        </p>
      </article>

      <div className="actions no-print">
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          <PrintIcon /> Print receipt
        </button>
        <Link to="/orders" className="btn">
          All orders
        </Link>
        <Link to="/" className="btn">
          Keep shopping
        </Link>
      </div>
    </>
  );
}
