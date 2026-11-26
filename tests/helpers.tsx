import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { expect, vi } from 'vitest';
import { AppRoutes } from '../src/App';
import { AnnouncerProvider } from '../src/components/Announcer';
import { DEFAULT_SIM, mockMpesa } from '../src/mock/mpesaMock';
import { CartProvider } from '../src/state/CartContext';
import { cartStore, resetDemoData } from '../src/state/stores';
import type { CartState } from '../src/state/cart';

export function renderApp(route = '/') {
  return render(
    <AnnouncerProvider>
      <CartProvider>
        <MemoryRouter initialEntries={[route]}>
          <AppRoutes />
        </MemoryRouter>
      </CartProvider>
    </AnnouncerProvider>,
  );
}

export function resetWorld(sim: Partial<typeof DEFAULT_SIM> = {}) {
  resetDemoData();
  mockMpesa.reset();
  mockMpesa.sim.set({ ...DEFAULT_SIM, latencyMs: 0, delaySec: 3, windowSec: 15, ...sim });
}

export function seedCart(partial: Partial<CartState> = {}) {
  cartStore.set({
    lines: [{ productId: 'maize-flour', variantId: 'maize-flour:1', qty: 2 }],
    promoCode: null,
    areaId: 'west',
    ...partial,
  });
}

/** user-event wired to vitest fake timers */
export const fakeUser = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

/** axe in jsdom: structure, names, roles, ARIA. Colour contrast needs a real browser (see e2e). */
export async function expectNoA11yViolations(container: Element) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary).toEqual([]);
}
