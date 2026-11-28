import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useOnline } from '../hooks/useOnline';
import { useCart } from '../state/CartContext';
import { providerStore, useStore } from '../state/stores';
import { CartDrawer } from './CartDrawer';
import { CartIcon } from './Icons';
import { Logo } from './Logo';
import { SearchBox } from './SearchBox';

const PhoneSimulator = lazy(() => import('../mock/PhoneSimulator'));

export function Layout() {
  const online = useOnline();
  const { view, openCart } = useCart();
  const provider = useStore(providerStore).choice;
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [simOpen, setSimOpen] = useState(false);
  const simToggle = useRef<HTMLButtonElement>(null);
  const simId = useId();

  const closeSim = useCallback(() => {
    setSimOpen(false);
    simToggle.current?.focus();
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

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
        <p>
          <strong>Demo shop.</strong>{' '}
          {provider === 'sandbox'
            ? 'Products and stock are invented and nothing will be delivered. The M-Pesa payment goes to Safaricom\u2019s sandbox and sends a real prompt to the phone number you enter, as a KES 1 test charge. Use only your own number.'
            : provider === 'gateway'
              ? 'Products and stock are invented. M-Pesa payments go to a live sandbox gateway that runs a mock Daraja: no real prompt is sent and no money moves.'
              : 'Products, stock and payments are simulated in your browser. No money moves.'}
        </p>
        <button
          ref={simToggle}
          type="button"
          className="sim-toggle"
          aria-expanded={simOpen}
          aria-controls={`${simId}-panel`}
          aria-haspopup="dialog"
          onClick={() => setSimOpen((v) => !v)}
        >
          Phone simulator
        </button>
      </div>
      {!online && (
        <div className="offline-banner no-print" role="status">
          You are offline. You can still browse and fill your cart. Checkout needs a connection to reach the live gateway; the
          in-browser simulator and pay on delivery still work.
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
            {provider === 'sandbox' ? (
              <p>
                A demo shop front-end. The shop, products and prices are made up and nothing will be delivered. You chose
                Safaricom&rsquo;s Daraja sandbox, which is not simulated: it sends a real M-Pesa prompt to the number you enter,
                for a flat KES 1 test charge. One KES 1 payment has been completed with a PIN here, a small sample, and whether
                approving a sandbox prompt debits a real wallet has not been checked. The mock-Daraja gateway and the in-browser simulator are the two choices that send no real prompt.
              </p>
            ) : (
              <p>
                A demo shop front-end. The shop, products and prices are made up. Payments go through a live sandbox
                payments gateway that runs a mock Daraja, so the payment, its ledger and its checks are real but the M-Pesa side
                is simulated and no money moves. An in-browser simulator is the offline fallback. A third choice, off unless you
                pick it, sends a real prompt through Safaricom&rsquo;s sandbox.
              </p>
            )}
          </section>
          <section aria-labelledby="f-help">
            <h2 id="f-help">Shop</h2>
            <ul className="footer-list">
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
              {provider === 'sandbox'
                ? ' Safaricom decides how a sandbox prompt ends, so the Phone simulator has nothing to pick for it.'
                : ' Use the \u201cPhone simulator\u201d button in the yellow bar at the top to pick how each payment ends.'}
            </p>
          </section>
        </div>
      </footer>
      <CartDrawer />
      {simOpen && (
        <Suspense fallback={null}>
          <PhoneSimulator
            id={`${simId}-panel`}
            onClose={closeSim}
          />
        </Suspense>
      )}
    </>
  );
}
