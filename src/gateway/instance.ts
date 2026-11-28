import { createGatewayClient } from './client';
import { SANDBOX_KEY, SANDBOX_URL } from './config';
import { SANDBOX_CHARGE_KES } from './sandbox';
import { createGatewayService } from './service';

/** The mock-Daraja gateway: the app-wide client and service. */
export const gatewayClient = createGatewayClient();
export const gatewayService = createGatewayService({ client: gatewayClient });

/** The second instance, which talks to Safaricom's real Daraja sandbox. */
export const sandboxClient = createGatewayClient({ baseUrl: SANDBOX_URL, key: SANDBOX_KEY });
export const sandboxService = createGatewayService({ client: sandboxClient, sandbox: { chargeKes: SANDBOX_CHARGE_KES } });
