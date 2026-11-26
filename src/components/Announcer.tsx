import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

const Ctx = createContext<(msg: string) => void>(() => undefined);

export const useAnnounce = () => useContext(Ctx);

/** One polite live region for the whole app: cart changes, filter results, and so on. */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const flip = useRef(false);
  const announce = useCallback((m: string) => {
    flip.current = !flip.current;
    // The trailing character makes identical messages re-announce.
    setMsg(m + (flip.current ? '' : ' '));
  }, []);
  const value = useMemo(() => announce, [announce]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
        {msg}
      </div>
    </Ctx.Provider>
  );
}
