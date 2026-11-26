import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, PRODUCTS, getProduct, priceRange } from '../data/catalogue';
import { PageTitle } from '../components/PageTitle';
import { ProductCard } from '../components/ProductCard';
import { searchProducts } from '../lib/search';
import { recentStore } from '../state/recent';
import { useStore } from '../state/stores';
import type { CategoryId, Product } from '../types';

type Sort = 'featured' | 'price-asc' | 'price-desc' | 'name';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'name', label: 'Name: A to Z' },
];

export function sortProducts(list: Product[], sort: Sort, keepRelevance: boolean): Product[] {
  if (sort === 'featured') {
    return keepRelevance ? list : [...list].sort((a, b) => Number(!!b.badge) - Number(!!a.badge) || 0);
  }
  const copy = [...list];
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  const key = (p: Product) => priceRange(p).min;
  return copy.sort((a, b) => (sort === 'price-asc' ? key(a) - key(b) : key(b) - key(a)) || a.name.localeCompare(b.name));
}

export default function ShopPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const cat = (CATEGORIES.some((c) => c.id === params.get('cat')) ? params.get('cat') : null) as CategoryId | null;
  const sortParam = params.get('sort');
  const sort: Sort = SORTS.some((s) => s.id === sortParam) ? (sortParam as Sort) : 'featured';
  const recent = useStore(recentStore);

  const results = useMemo(() => {
    const found = searchProducts(PRODUCTS, q);
    const byCat = cat ? found.filter((p) => p.category === cat) : found;
    return sortProducts(byCat, sort, q.trim() !== '');
  }, [q, cat, sort]);

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  }

  const filtered = q.trim() !== '' || cat !== null;
  const recentProducts = recent.map((s) => getProduct(s)).filter((p): p is Product => !!p).slice(0, 4);

  const pageTitle = q ? `Results for "${q}"` : cat ? (CATEGORIES.find((c) => c.id === cat)?.name ?? 'Shop') : 'Shop';

  return (
    <>
      {filtered ? (
        <PageTitle title={pageTitle}>{q ? `Results for “${q}”` : (CATEGORIES.find((c) => c.id === cat)?.name ?? 'Shop')}</PageTitle>
      ) : (
        <section className="hero" aria-label="Welcome">
          <p className="hero__kicker">Karibu, welcome</p>
          <PageTitle title="Shop">Everything for the kitchen and the home, paid for with M-Pesa.</PageTitle>
          <p>Order here, approve the prompt on your phone, and we deliver across Nairobi or keep it ready for pickup.</p>
          <div className="hero__chips">
            <span className="hero__chip">
              Try code <code>KARIBU10</code>
            </span>
            <span className="hero__chip">Free delivery over KES 5,000</span>
            <span className="hero__chip">Pay on delivery too</span>
          </div>
        </section>
      )}

      {!filtered && recentProducts.length > 0 && (
        <section className="section" aria-labelledby="recent-h" style={{ marginTop: 0, marginBottom: '1.5rem' }}>
          <h2 id="recent-h">Recently viewed</h2>
          <ul className="grid">
            {recentProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="catalogue-h">
        <h2 id="catalogue-h" className={filtered ? 'sr-only' : ''}>
          All products
        </h2>
        <ul className="chips" aria-label="Filter by category">
          <li>
            <button type="button" className="chip" aria-pressed={cat === null} onClick={() => update({ cat: null })}>
              All
            </button>
          </li>
          {CATEGORIES.map((c) => (
            <li key={c.id}>
              <button type="button" className="chip" aria-pressed={cat === c.id} onClick={() => update({ cat: c.id })}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="toolbar">
          <p className="result-count" role="status" aria-live="polite" data-testid="result-count">
            {results.length} {results.length === 1 ? 'product' : 'products'}
            {q ? ` for “${q}”` : ''}
          </p>
          <div>
            <label htmlFor="sort">Sort by</label>
            <select id="sort" value={sort} onChange={(e) => update({ sort: e.target.value === 'featured' ? null : e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {results.length > 0 ? (
          <ul className="grid" data-testid="product-grid">
            {results.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ul>
        ) : (
          <div className="empty">
            <h3>Nothing matches that</h3>
            <p>Check the spelling, or try a simpler word such as &ldquo;unga&rdquo;, &ldquo;soap&rdquo; or &ldquo;tea&rdquo;.</p>
            <Link className="btn btn--primary" to="/">
              Clear search and filters
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
