import { useCallback, useEffect, useState } from 'react';
import { GatewayError } from '../gateway/client';
import { DEMO_CAP_KES, SANDBOX_CAP_KES } from '../gateway/config';
import { gatewayClient, sandboxClient } from '../gateway/instance';

export type GatewayStatusState = 'checking' | 'ok' | 'unreachable' | 'rate_limited';

export interface GatewayStatusInfo {
  state: GatewayStatusState;
  /** the largest amount the demo key accepts, from the gateway when it told us */
  capKes: number;
  /** seconds to wait, when rate limited */
  retryAfterSec: number | null;
  mode: string | null;
  /** sandbox: 'any_number' or 'approved_numbers_only', when the gateway said */
  phonePolicy: string | null;
  recheck: () => void;
}

interface Probe {
  key: string;
  state: Exclude<GatewayStatusState, 'checking'>;
  capKes?: number;
  retryAfterSec?: number | null;
  mode?: string | null;
  phonePolicy?: string | null;
}

/**
 * Is the live gateway reachable right now? Probes the unauthenticated GET /v1/config once
 * when enabled, and again when the browser comes back online or the shopper asks. It only
 * runs while a gateway is the chosen provider, so choosing the simulator makes no request.
 * `which` picks the instance: the mock-Daraja gateway or the Safaricom sandbox one.
 */
export function useGatewayStatus(enabled: boolean, online: boolean, which: 'gateway' | 'sandbox' = 'gateway'): GatewayStatusInfo {
  const [nonce, setNonce] = useState(0);
  const [probe, setProbe] = useState<Probe | null>(null);
  const key = `${which}:${nonce}:${online ? 'on' : 'off'}`;

  useEffect(() => {
    if (!enabled || !online) return;
    let current = true;
    (which === 'sandbox' ? sandboxClient : gatewayClient)
      .config()
      .then((cfg) => {
        if (!current) return;
        const cap = cfg.limits?.publishable_key_max_amount;
        setProbe({
          key,
          state: 'ok',
          ...(typeof cap === 'number' && cap > 0 ? { capKes: cap } : {}),
          mode: cfg.mode ?? null,
          phonePolicy: cfg.phone_policy ?? null,
        });
      })
      .catch((err: unknown) => {
        if (!current) return;
        if (err instanceof GatewayError && err.kind === 'rate_limited') {
          setProbe({ key, state: 'rate_limited', retryAfterSec: err.retryAfterSec });
        } else {
          setProbe({ key, state: 'unreachable' });
        }
      });
    return () => {
      current = false;
    };
  }, [enabled, online, key, which]);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  const state: GatewayStatusState = !online ? 'unreachable' : probe && probe.key === key ? probe.state : 'checking';
  const fresh = probe && probe.key === key ? probe : null;
  const capKes = fresh?.capKes ?? (which === 'sandbox' ? SANDBOX_CAP_KES : DEMO_CAP_KES);
  return { state, capKes, retryAfterSec: fresh?.retryAfterSec ?? null, mode: fresh?.mode ?? null, phonePolicy: fresh?.phonePolicy ?? null, recheck };
}
