import { createGatewayClient } from './client';
import { createGatewayService } from './service';

/** The app-wide gateway client and service. */
export const gatewayClient = createGatewayClient();
export const gatewayService = createGatewayService({ client: gatewayClient });
