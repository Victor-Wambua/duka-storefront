import { isGatewayId } from '../gateway/service';
import type { PaymentService, ProviderId } from './types';

/**
 * One PaymentService in front of both backends. A new payment goes to the provider
 * the shopper picked; everything about an existing payment goes to whichever backend
 * created it, which its id tells us. That is what lets a reload mid-payment, or a
 * switch of provider on the next attempt, never cross the wires.
 */
export function createRoutingService(parts: {
  simulator: PaymentService;
  gateway: PaymentService;
  current: () => ProviderId;
}): PaymentService {
  const byId = (id: string) => (isGatewayId(id) ? parts.gateway : parts.simulator);
  const byProvider = (p: ProviderId | undefined) => ((p ?? parts.current()) === 'gateway' ? parts.gateway : parts.simulator);
  return {
    initiateStkPush: (req) => byProvider(req.provider).initiateStkPush(req),
    queryStatus: (id) => byId(id).queryStatus(id),
    cancel: (id) => byId(id).cancel(id),
    lookupPayment: (q) => byProvider(q.provider).lookupPayment(q),
    pollSchedule: (id) => byId(id).pollSchedule?.(id),
  };
}
