import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { formatKES } from '../lib/money';
import { useCart } from '../state/CartContext';
import { DeliveryPicker, PromoField, Stepper, TotalsList } from './CartControls';
import { ProductArt } from './ProductArt';

export function CartDrawer() {
  const { drawerOpen, closeCart, view, setQty, remove } = useCart();
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (drawerOpen && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      headingRef.current?.focus();
    } else if (!drawerOpen && d.open) {
      d.close();
    }
  }, [drawerOpen]);

  function onClose() {
    closeCart();
    const el = opener.current;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }

  const empty = view.lines.length === 0;

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="cart-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCart();
      }}
    >
      {drawerOpen && (
        <>
          <div className="drawer__head">
            <h2 id="cart-title" ref={headingRef} tabIndex={-1}>
              Your cart <span className="num">({view.count})</span>
            </h2>
            <button type="button" className="drawer__close" onClick={closeCart}>
              Close<span className="sr-only"> cart</span>
            </button>
          </div>
          <p className="sr-only" role="status">
            {empty
              ? 'Your cart is empty.'
              : `${view.count} ${view.count === 1 ? 'item' : 'items'} in your cart. Total ${formatKES(view.pricing.total)}.`}
          </p>
          <div className="drawer__body">
            {empty ? (
              <div className="empty">
                <h3>Your cart is empty</h3>
                <p>Add a few things from the shelves and they will show up here.</p>
                <Link to="/" className="btn btn--primary" onClick={closeCart}>
                  Browse the shop
                </Link>
              </div>
            ) : (
              <>
                <ul className="lines" aria-label="Items in your cart">
                  {view.lines.map((l) => {
                    const label = `${l.product.name}, ${l.variant.label}`;
                    return (
                      <li key={l.variant.id} className="line">
                        <ProductArt art={l.product.art} tint={l.variant.tint} />
                        <div>
                          <p className="line__name">
                            <Link to={`/product/${l.product.slug}`} onClick={closeCart}>
                              {l.product.name}
                            </Link>
                          </p>
                          <p className="line__meta">
                            {l.variant.label} · <span className="num">{formatKES(l.unitPrice)}</span> each
                          </p>
                          <div className="line__row">
                            <Stepper label={label} qty={l.line.qty} max={l.available} onChange={(q) => setQty(l.variant.id, q)} />
                            <span className="line__total num">{formatKES(l.lineTotal)}</span>
                          </div>
                          {l.atLimit && (
                            <p className="line__limit" role="note">
                              That is all we have: {l.available} in stock.
                            </p>
                          )}
                          <button type="button" className="link-btn" onClick={() => remove(l.variant.id)}>
                            Remove<span className="sr-only"> {label}</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <PromoField view={view} />
                <DeliveryPicker view={view} />
                <TotalsList view={view} />
              </>
            )}
          </div>
          {!empty && (
            <div className="drawer__foot">
              <Link to="/checkout" className="btn btn--primary btn--block" onClick={closeCart}>
                Checkout · {formatKES(view.pricing.total)}
              </Link>
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
