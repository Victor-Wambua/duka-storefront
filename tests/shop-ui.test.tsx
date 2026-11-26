import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoA11yViolations, renderApp, resetWorld, seedCart } from './helpers';
import { cartStore } from '../src/state/stores';

beforeEach(() => {
  resetWorld();
  cartStore.set({ lines: [], promoCode: null, areaId: null });
});

describe('shop page', () => {
  it('has landmarks, a skip link and one h1', async () => {
    renderApp('/');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('lists every product and filters instantly as you type, tolerating typos', async () => {
    const user = userEvent.setup();
    renderApp('/');
    expect(screen.getByTestId('result-count')).toHaveTextContent('41 products');
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'sufria');
    expect(screen.getByTestId('result-count')).toHaveTextContent('1 product for “sufria”');
    expect(within(screen.getByTestId('product-grid')).getByRole('link', { name: 'Aluminium sufuria' })).toBeInTheDocument();
  });

  it('category chips toggle with aria-pressed and filter the grid', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const all = screen.getByRole('button', { name: 'All' });
    const cleaning = screen.getByRole('button', { name: 'Cleaning' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    await user.click(cleaning);
    expect(cleaning).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('result-count')).toHaveTextContent('6 products');
  });

  it('sorts by price', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'price-asc');
    const first = within(screen.getByTestId('product-grid')).getAllByRole('heading', { level: 3 })[0]!;
    expect(first).toHaveTextContent(/Drinking water|Table salt|Tomato paste/);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'price-desc');
    expect(within(screen.getByTestId('product-grid')).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent(/blanket|sheet|flask|kikapu|Vacuum|Cotton bed/i);
  });

  it('shows a helpful empty state', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.type(screen.getByRole('searchbox'), 'zzzzzz');
    expect(screen.getByText('Nothing matches that')).toBeInTheDocument();
    expect(screen.getByTestId('result-count')).toHaveTextContent('0 products');
  });

  it('has no axe violations', async () => {
    const { container } = renderApp('/');
    await expectNoA11yViolations(container);
  });
});

describe('product page', () => {
  it('switches price with the selected variant and marks the group', async () => {
    const user = userEvent.setup();
    renderApp('/product/maize-flour');
    expect(screen.getByRole('heading', { level: 1, name: 'Maize flour' })).toBeInTheDocument();
    expect(screen.getByTestId('price')).toHaveTextContent('KES 95');
    const group = screen.getByRole('group', { name: 'Size' });
    await user.click(within(group).getByRole('radio', { name: /5 kg/ }));
    expect(screen.getByTestId('price')).toHaveTextContent('KES 450');
  });

  it('adds to cart, updates the header count and announces it', async () => {
    const user = userEvent.setup();
    renderApp('/product/maize-flour');
    await user.click(screen.getByRole('button', { name: /Add to cart/ }));
    expect(screen.getByTestId('cart-count')).toHaveTextContent('1 item');
    expect(screen.getByTestId('announcer')).toHaveTextContent(/Maize flour, 1 kg added to cart\. Cart: 1 item, KES.95/);
  });

  it('never lets you add more than is in stock', async () => {
    const user = userEvent.setup();
    renderApp('/product/tomato-paste');
    await user.click(screen.getByRole('radio', { name: /400 g/ })); // 3 in stock
    expect(screen.getByTestId('stock')).toHaveTextContent('Only 3 left');
    const plus = screen.getByRole('button', { name: /Increase quantity/ });
    await user.click(plus);
    await user.click(plus);
    expect(plus).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Add to cart/ }));
    expect(screen.getByTestId('cart-count')).toHaveTextContent('3 items');
    expect(screen.getByRole('button', { name: 'All in your cart' })).toBeDisabled();
    expect(screen.getByTestId('stock')).toHaveTextContent('3 in your cart');
  });

  it('shows related items and recently viewed', async () => {
    renderApp('/product/maize-flour');
    expect(screen.getByRole('heading', { name: 'You might also like' })).toBeInTheDocument();
  });

  it('has a not-found state for unknown products', () => {
    renderApp('/product/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: /could not find that product/ })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderApp('/product/kanga-cloth');
    await expectNoA11yViolations(container);
  });
});

describe('cart drawer', () => {
  it('opens as a labelled dialog, empty at first, and returns focus on close', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const opener = screen.getByRole('button', { name: /Cart,/ });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: /Your cart/ });
    expect(within(dialog).getByText('Your cart is empty')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Close/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('has quantity steppers that respect stock and remove at zero', async () => {
    const user = userEvent.setup();
    seedCart({ lines: [{ productId: 'tomato-paste', variantId: 'tomato-paste:2', qty: 2 }], areaId: null });
    renderApp('/');
    await user.click(screen.getByRole('button', { name: /Cart,/ }));
    const dialog = screen.getByRole('dialog');
    const plus = within(dialog).getByRole('button', { name: /Increase quantity of Tomato paste, 400 g/ });
    await user.click(plus); // 3 = stock
    expect(plus).toBeDisabled();
    expect(within(dialog).getByRole('note')).toHaveTextContent('That is all we have: 3 in stock.');
    expect(screen.getByTestId('announcer')).toHaveTextContent('Quantity 3.');
    const minus = within(dialog).getByRole('button', { name: /Decrease quantity/ });
    await user.click(minus);
    await user.click(minus);
    await user.click(minus);
    expect(within(dialog).getByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByTestId('announcer')).toHaveTextContent('Item removed from cart.');
  });

  it('prices in whole shillings with promo and delivery', async () => {
    const user = userEvent.setup();
    seedCart({ lines: [{ productId: 'sufuria', variantId: 'sufuria:2', qty: 2 }], areaId: null }); // 2 x 1180 = 2360
    renderApp('/');
    await user.click(screen.getByRole('button', { name: /Cart,/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('grand-total')).toHaveTextContent('KES 2,360');

    await user.type(within(dialog).getByLabelText('Promo code'), 'nope');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(within(dialog).getByText(/not valid/)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Promo code'));
    await user.type(within(dialog).getByLabelText('Promo code'), 'karibu10');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(within(dialog).getByText('KARIBU10 applied')).toBeInTheDocument();
    expect(within(dialog).getByTestId('grand-total')).toHaveTextContent('KES 2,124'); // 2360 - 236

    await user.selectOptions(within(dialog).getByLabelText('Delivery or pickup area'), 'west'); // +200
    expect(within(dialog).getByTestId('grand-total')).toHaveTextContent('KES 2,324');
    expect(within(dialog).getByText(/Add KES.2,876 more for free delivery/)).toBeInTheDocument();
  });

  it('links to checkout', async () => {
    const user = userEvent.setup();
    seedCart();
    renderApp('/');
    await user.click(screen.getByRole('button', { name: /Cart,/ }));
    expect(screen.getByRole('link', { name: /Checkout/ })).toHaveAttribute('href', '/checkout');
  });

  it('has no axe violations with items in it', async () => {
    const user = userEvent.setup();
    seedCart();
    const { container } = renderApp('/');
    await user.click(screen.getByRole('button', { name: /Cart,/ }));
    await act(async () => undefined);
    await expectNoA11yViolations(container);
  });
});
