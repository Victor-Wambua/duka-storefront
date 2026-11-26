import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageTitle } from '../components/PageTitle';
import { finalizePaid } from '../checkout/finalize';
import { formatKES } from '../lib/money';
import { normalisePhone, phoneMessage } from '../lib/phone';
import { mockMpesa } from '../mock/mpesaMock';
import { normaliseRef } from '../state/orders';
import { ordersStore, useStore } from '../state/stores';
import { StatusBadge } from './OrderPage';

export default function OrdersPage() {
  const orders = useStore(ordersStore);
  const navigate = useNavigate();
  const id = useId();
  const [ref, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const r = normaliseRef(ref);
    const p = normalisePhone(phone);
    if (!/^DUKA-[A-Z0-9]{6}$/.test(r)) return setError('Enter the order reference exactly as shown on your receipt, like DUKA-7K3Q9X.');
    if (!p.ok) return setError(phoneMessage(p.reason));
    const found = orders.find((o) => o.ref === r && o.customer.msisdn === p.msisdn);
    if (!found) {
      return setError('No order on this device matches that reference and phone number. Orders are stored in this browser only.');
    }
    if (found.status === 'pending_payment') {
      setBusy(true);
      try {
        const res = await mockMpesa.lookupPayment({ orderRef: found.ref, msisdn: found.customer.msisdn });
        if (res.state === 'paid') finalizePaid(found.ref, res.receipt, res.paidAt);
      } catch {
        /* the order page offers a manual re-check */
      } finally {
        setBusy(false);
      }
    }
    navigate(`/order/${found.ref}`);
  }

  return (
    <>
      <PageTitle title="Orders">Your orders</PageTitle>

      <section className="panel" aria-labelledby={`${id}-find`}>
        <h2 id={`${id}-find`}>Find an order</h2>
        <p className="field__hint">Enter the reference from your receipt and the phone number you ordered with.</p>
        <form onSubmit={lookup} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-ref`}>
              Order reference
            </label>
            <input id={`${id}-ref`} type="text" autoCapitalize="characters" autoComplete="off" placeholder="DUKA-7K3Q9X" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-phone`}>
              Phone number
            </label>
            <input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Checking…' : 'Find order'}
          </button>
        </form>
      </section>

      <section aria-labelledby={`${id}-list`}>
        <h2 id={`${id}-list`}>Orders on this device</h2>
        {orders.length === 0 ? (
          <div className="empty">
            <p>No orders yet. When you place one it will appear here.</p>
            <Link to="/" className="btn btn--primary">
              Browse the shop
            </Link>
          </div>
        ) : (
          <ul className="order-list">
            {orders.map((o) => (
              <li key={o.ref}>
                <Link to={`/order/${o.ref}`} className="panel" style={{ marginBottom: 0 }}>
                  <span className="order-row">
                    <strong>{o.ref}</strong>
                    <StatusBadge order={o} />
                  </span>
                  <span className="order-row" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                    <span>
                      {new Date(o.createdAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })} ·{' '}
                      {o.lines.reduce((n, l) => n + l.qty, 0)} items
                    </span>
                    <span className="num" style={{ fontWeight: 800, color: 'var(--text)' }}>
                      {formatKES(o.pricing.total)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="sample-note">Orders are kept in this browser only. Clearing site data removes them.</p>
      </section>
    </>
  );
}
