import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The page's h1. On client-side navigation it takes focus (so screen reader and
 * keyboard users land at the top of the new page) and sets document.title.
 */
export function PageTitle({ children, title, className }: { children: ReactNode; title: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { key } = useLocation();
  useEffect(() => {
    document.title = `${title} | Duka Storefront`;
  }, [title]);
  useEffect(() => {
    // react-router gives the first entry the key "default": do not steal focus on first load
    if (key !== 'default') ref.current?.focus({ preventScroll: true });
  }, [key]);
  return (
    <h1 ref={ref} tabIndex={-1} {...(className ? { className } : {})}>
      {children}
    </h1>
  );
}
