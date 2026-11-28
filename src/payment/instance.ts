import { gatewayService } from '../gateway/instance';
import { mockMpesa } from '../mock/mpesaMock';
import { providerStore } from '../state/stores';
import { createRoutingService } from './router';

/** What the checkout, the order page and the orders page talk to. */
export const paymentService = createRoutingService({
  simulator: mockMpesa,
  gateway: gatewayService,
  current: () => providerStore.get().choice,
});
