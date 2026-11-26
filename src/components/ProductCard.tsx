import { Link } from 'react-router-dom';
import { priceRange } from '../data/catalogue';
import { formatKES } from '../lib/money';
import { stockOf, useStore, inventoryStore } from '../state/stores';
import type { Product } from '../types';
import { ProductArt } from './ProductArt';

export function ProductCard({ product }: { product: Product }) {
  const inv = useStore(inventoryStore);
  const { min, max } = priceRange(product);
  const inStock = product.variants.filter((v) => stockOf(v.id, inv) > 0);
  const totalLeft = inStock.reduce((n, v) => n + stockOf(v.id, inv), 0);
  const soldOut = inStock.length === 0;
  const low = !soldOut && totalLeft <= 5;
  const first = product.variants[0];
  return (
    <li>
      <article className="card">
        {product.badge && <span className="badge">{product.badge}</span>}
        <ProductArt art={product.art} tint={first?.tint} />
        <div className="card__body">
          <h3 className="card__name">
            <Link className="card__link" to={`/product/${product.slug}`}>
              {product.name}
            </Link>
          </h3>
          <p className="card__blurb">{product.blurb}</p>
          <div className="card__foot">
            <span className="price">
              {min === max ? formatKES(min) : (
                <>
                  <small>from</small> {formatKES(min)}
                </>
              )}
            </span>
            {soldOut && <span className="stock-note stock-note--out">Sold out</span>}
            {low && <span className="stock-note">Only {totalLeft} left</span>}
          </div>
        </div>
      </article>
    </li>
  );
}
