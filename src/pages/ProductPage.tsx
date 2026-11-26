import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Stepper } from '../components/CartControls';
import { PageTitle } from '../components/PageTitle';
import { ProductArt } from '../components/ProductArt';
import { ProductCard } from '../components/ProductCard';
import { categoryName, getProduct, relatedProducts } from '../data/catalogue';
import { formatKES } from '../lib/money';
import { useCart } from '../state/CartContext';
import { remainingFor } from '../state/cart';
import { cartStore, stockOf, useStore } from '../state/stores';
import { recentStore, trackViewed } from '../state/recent';
import type { Product } from '../types';
import NotFound from './NotFound';

export default function ProductPage() {
  const { slug } = useParams();
  const product = getProduct(slug);
  if (!product) return <NotFound what="product" />;
  return <ProductView key={product.id} product={product} />;
}

function ProductView({ product }: { product: Product }) {
  const { add, openCart, view } = useCart();
  const cart = useStore(cartStore);
  const recent = useStore(recentStore);
  const groupId = useId();
  const firstInStock = Math.max(
    0,
    product.variants.findIndex((v) => stockOf(v.id) > 0),
  );
  const [vi, setVi] = useState(firstInStock);
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => trackViewed(product.slug), [product.slug]);

  const variant = product.variants[vi]!;
  const stock = stockOf(variant.id);
  const room = remainingFor(cart, variant.id, (id) => stockOf(id));
  const inCart = stock - room;
  const maxQty = Math.max(1, room);
  const shownQty = Math.min(qty, maxQty);

  const related = relatedProducts(product, 4);
  const seen = recent
    .filter((s) => s !== product.slug)
    .map((s) => getProduct(s))
    .filter((p): p is Product => !!p)
    .slice(0, 4);

  function onAdd() {
    const res = add(product, variant, shownQty);
    setJustAdded(variant.id);
    setNote(
      res.added === 0
        ? 'You already have every one we have in stock.'
        : res.limited
          ? `Added ${res.added}. That is all we have in stock.`
          : `Added ${res.added} to your cart.`,
    );
    setQty(1);
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link to="/">Shop</Link>
          </li>
          <li>
            <Link to={`/?cat=${product.category}`}>{categoryName(product.category)}</Link>
          </li>
          <li aria-current="page">{product.name}</li>
        </ol>
      </nav>

      <div className="product">
        <div className="product__art">
          <ProductArt art={product.art} tint={variant.tint} />
        </div>
        <div>
          <PageTitle title={product.name}>{product.name}</PageTitle>
          <p style={{ color: 'var(--text-muted)' }}>{product.blurb}</p>
          <p className="product__price num" data-testid="price">
            {formatKES(variant.price)}
          </p>

          <fieldset className="variants">
            <legend>{product.variantKind}</legend>
            <div className="variants__list">
              {product.variants.map((v, i) => {
                const left = stockOf(v.id);
                return (
                  <label key={v.id} className="variant">
                    <input
                      type="radio"
                      name={`${groupId}-variant`}
                      value={v.id}
                      checked={i === vi}
                      disabled={left === 0}
                      onChange={() => {
                        setVi(i);
                        setQty(1);
                        setNote(null);
                      }}
                    />
                    <span>
                      {v.label}
                      <small>{left === 0 ? 'Sold out' : formatKES(v.price)}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p className={stock === 0 ? 'stock-note stock-note--out' : stock <= 5 ? 'stock-note' : 'field__hint'} data-testid="stock">
            {stock === 0 ? 'Sold out' : stock <= 5 ? `Only ${stock} left` : 'In stock'}
            {inCart > 0 && stock > 0 ? ` · ${inCart} in your cart` : ''}
          </p>

          <div className="buy-row">
            {room > 0 && (
              <Stepper label={`${product.name}, ${variant.label}`} qty={shownQty} max={maxQty} onChange={(q) => setQty(Math.max(1, q))} />
            )}
            <button type="button" className="btn btn--primary" onClick={onAdd} disabled={room === 0}>
              {stock === 0 ? 'Sold out' : room === 0 ? 'All in your cart' : `Add to cart · ${formatKES(variant.price * shownQty)}`}
            </button>
          </div>
          {justAdded === variant.id && note && (
            <p role="status" className="notice notice--ok" style={{ marginBottom: '0.75rem' }}>
              {note}{' '}
              <button type="button" className="link-btn" onClick={openCart}>
                View cart ({view.count})
              </button>
            </p>
          )}

          <h2 style={{ fontSize: 'var(--fs-lg)', marginTop: 'var(--s-5)' }}>About this item</h2>
          <p>{product.description}</p>
          <ul className="meta-list">
            <li>Category: {categoryName(product.category)}</li>
            <li>Pay with M-Pesa or on delivery. Pickup is free.</li>
          </ul>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section" aria-labelledby="related-h">
          <h2 id="related-h">You might also like</h2>
          <ul className="grid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ul>
        </section>
      )}
      {seen.length > 0 && (
        <section className="section" aria-labelledby="seen-h">
          <h2 id="seen-h">Recently viewed</h2>
          <ul className="grid">
            {seen.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
