import { lazy } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AnnouncerProvider } from './components/Announcer';
import { Layout } from './components/Layout';
import { CartProvider } from './state/CartContext';
import NotFound from './pages/NotFound';
import ProductPage from './pages/ProductPage';
import ShopPage from './pages/ShopPage';

const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const OrderPage = lazy(() => import('./pages/OrderPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));

/**
 * HashRouter on purpose: the demo is served from a sub-path on static hosting
 * (GitHub Pages), where history-API routes would 404 on reload.
 */
export function AppRoutes() {
  return (
    <Routes>
        <Route element={<Layout />}>
          <Route index element={<ShopPage />} />
          <Route path="product/:slug" element={<ProductPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="order/:ref" element={<OrderPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AnnouncerProvider>
      <CartProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </CartProvider>
    </AnnouncerProvider>
  );
}
