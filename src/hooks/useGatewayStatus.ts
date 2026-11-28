import { useCallback, useEffect, useState } from 'react';
import { GatewayError } from '../gateway/client';
import { DEMO_CAP_KES } from '../gateway/config';
import { gatewayClient } from '../gateway/instance';

export type GatewayStatusState = 'checking' | 'ok' | 'unreachable' | 'rate_limited';

export interface GatewayStatusInfo {
  state: GatewayStatusState;
  /** the largest amount the demo key accepts, from the gateway when it told us */
  capKes: number;
  /** seconds to wait, when rate limited */
  retryAfterSec: number | null;
  mode: string | null;
  recheck: () => void;
}

interface Probe {
  key: string;
  state: Exclude<GatewayStatusState, 'checking'>;
  capKes?: number;
  retryAfterSec?: number | null;
  mode?: string | null;
}

/**
 * Is the live gateway reachable right now? Probes the unauthenticated GET /v1/config once
 * when enabled, and again when the browser comes back online or the shopper asks. It only
 * runs while the gateway is the chosen provider, so choosing the simulator makes no request.
 */
export function useGatewayStatus(enabled: boolean, online: boolean): GatewayStatusInfo {
  const [nonce, setNonce] = useState(0);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [capKes, setCapKes] = useState(DEMO_CAP_KES);
  const key = `${nonce}:${online ? 'on' : 'off'}`;

  useEffect(() => {
    if (!enabled || !online) return;
    let current = true;
    gatewayClient
      .config()
      .then((cfg) => {
        if (!current) return;
        const cap = cfg.limits?.publishable_key_max_amount;
        if (typeof cap === 'number' && cap > 0) setCapKes(cap);
        setProbe({ key, state: 'ok', mode: cfg.mode ?? null });
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
  }, [enabled, online, key]);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  const state: GatewayStatusState = !online ? 'unreachable' : probe && probe.key === key ? probe.state : 'checking';
  return { state, capKes, retryAfterSec: probe?.retryAfterSec ?? null, mode: probe?.mode ?? null, recheck };
}
