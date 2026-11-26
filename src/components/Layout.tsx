import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useOnline } from '../hooks/useOnline';
import { useCart } from '../state/CartContext';
import { CartDrawer } from './CartDrawer';
import { CartIcon } from './Icons';
import { Logo } from './Logo';
import { SearchBox } from './SearchBox';

const PhoneSimulator = lazy(() => import('../mock/PhoneSimulator'));

export function Layout() {
  const online = useOnline();
  const { view, openCart } = useCart();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [showSim, setShowSim] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // Load the demo overlay after the shop is interactive; it is not part of the shopping path.
  useEffect(() => {
    const id = window.setTimeout(() => setShowSim(true), 300);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
          mainRef.current?.scrollIntoView();
        }}
      >
        Skip to main content
      </a>
      <div className="demo-banner no-print">
        <strong>Demo shop.</strong> Products, stock and payments are simulated. No money moves.
      </div>
      {!online && (
        <div className="offline-banner no-print" role="status">
          You are offline. You can still browse and fill your cart. Checkout needs a connection.
        </div>
      )}
      <header className="site-header">
        <div className="container site-header__row">
          <Link to="/" className="brand">
            <Logo />
            <span className="brand__name">
              Mama Lucy&rsquo;s
              <span className="brand__sub">Provisions &amp; Homeware</span>
            </span>
          </Link>
          <nav className="header-links" aria-label="Main">
            <NavLink to="/" end>
              Shop
            </NavLink>
            <NavLink to="/orders">Orders</NavLink>
          </nav>
          <button type="button" className="cart-btn" onClick={openCart} aria-haspopup="dialog">
            <CartIcon />
            <span className="sr-only">Cart, </span>
            <span className="cart-btn__count num" data-testid="cart-count">
              {view.count}
              <span className="sr-only"> {view.count === 1 ? 'item' : 'items'}</span>
            </span>
          </button>
        </div>
        <SearchBox />
      </header>
      <div className="kanga" aria-hidden="true" />
      <main id="main" ref={mainRef} tabIndex={-1}>
        <div className="container">
          <Suspense fallback={<p role="status" className="field__hint">Loading…</p>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <footer className="site-footer no-print">
        <div className="container site-footer__grid">
          <section aria-labelledby="f-about">
            <h2 id="f-about">Mama Lucy&rsquo;s (fictional)</h2>
            <p>
              A demo shop front-end. The shop, products and prices are made up; the payment flow is a faithful
              rehearsal of M-Pesa STK push, run against an in-browser mock.
            </p>
          </section>
          <section aria-labelledby="f-help">
            <h2 id="f-help">Shop</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
              <li>
                <Link to="/">All products</Link>
              </li>
              <li>
                <Link to="/orders">My orders and order lookup</Link>
              </li>
              <li>
                Sample promo codes: <code>KARIBU10</code>, <code>JAMBO200</code>, <code>FREESHIP</code>
              </li>
            </ul>
          </section>
          <section aria-labelledby="f-code">
            <h2 id="f-code">Open source</h2>
            <p>
              <a href="https://github.com/Victor-Wambua/duka-storefront">Source on GitHub</a>. Built by Victor Wambua.
              Use the yellow &ldquo;Phone simulator&rdquo; button to pick how each payment ends.
            </p>
          </section>
        </div>
      </footer>
      <CartDrawer />
      {showSim && (
        <Suspense fallback={null}>
          <PhoneSimulator />
        </Suspense>
      )}
    </>
  );
}
