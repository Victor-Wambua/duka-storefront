import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { showUpdateBanner, watchForUpdate } from './lib/swUpdate';
import './styles/tokens.css';
import './styles/app.css';
import './styles/print.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => watchForUpdate(navigator.serviceWorker, registration, () => showUpdateBanner(document)))
      .catch(() => undefined);
  });
}
