import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

// Module-level on purpose: the shop page swaps its hero for a plain heading while
// you search, which remounts this component. That must not count as a page change.
let lastPath: string | null = null;

export function resetPageFocusTracking(): void {
  lastPath = null;
}

/**
 * The page's h1. On client-side navigation it takes focus (so screen reader and
 * keyboard users land at the top of the new page) and sets document.title.
 */
export function PageTitle({ children, title, className }: { children: ReactNode; title: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { key, pathname } = useLocation();
  useEffect(() => {
    document.title = `${title} | Duka Storefront`;
  }, [title]);
  useEffect(() => {
    // Only a real page change moves focus: not first load (key "default"), and not
    // query-string changes such as typing in the search box.
    if (lastPath === pathname) return;
    lastPath = pathname;
    if (key !== 'default') ref.current?.focus({ preventScroll: true });
  }, [key, pathname]);
  return (
    <h1 ref={ref} tabIndex={-1} {...(className ? { className } : {})}>
      {children}
    </h1>
  );
}
