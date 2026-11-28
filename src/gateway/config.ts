/**
 * Where the live payments gateway is, and the key this browser app uses to call it.
 *
 * A static browser app cannot keep a secret: anything shipped here is readable by
 * every visitor. The key below is the gateway's *publishable* demo key. It is public
 * by design and can only create sandbox payments up to a small cap (KES 1,000) for the
 * demo merchant, read those payments, and nothing else (no refunds, no secret-key
 * powers). The gateway is rate limited and answers with masked phone numbers.
 *
 * Both values can be overridden at build time:
 *   VITE_GATEWAY_URL=https://your-gateway.example  VITE_GATEWAY_KEY=pk_...
 */
const env = import.meta.env as Record<string, string | undefined>;

export const GATEWAY_URL = (env.VITE_GATEWAY_URL || 'https://mpesa-gateway.victorwambua004.workers.dev').replace(/\/+$/, '');

export const GATEWAY_KEY = env.VITE_GATEWAY_KEY || 'pk_sandbox_duka_demo_4f9c2a7e';

/** The gateway's inspector page (no deep link to a single payment is supported). */
export const INSPECTOR_URL = `${GATEWAY_URL}/`;

/** The publishable key's cap per payment. The gateway enforces it; we check first to explain it. */
export const DEMO_CAP_KES = 1000;

/** Give up on a single request after this long. */
export const REQUEST_TIMEOUT_MS = 10_000;
