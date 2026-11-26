import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SearchIcon } from './Icons';

/** Instant search: filters as you type, and the query lives in the URL so it can be shared. */
export function SearchBox() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const q = pathname === '/' ? (params.get('q') ?? '') : '';

  function setQuery(value: string) {
    if (pathname === '/') {
      const next = new URLSearchParams(params);
      if (value) next.set('q', value);
      else next.delete('q');
      setParams(next, { replace: true });
    } else {
      navigate(value ? `/?q=${encodeURIComponent(value)}` : '/');
    }
  }

  return (
    <form role="search" className="header-search container" onSubmit={(e) => e.preventDefault()} aria-label="Shop search">
      <div className="search">
        <SearchIcon />
        <label htmlFor="shop-search" className="sr-only">
          Search products
        </label>
        <input
          id="shop-search"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search: unga, sufuria, chai..."
          value={q}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <button type="button" className="search__clear" aria-label="Clear search" onClick={() => setQuery('')}>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
    </form>
  );
}
