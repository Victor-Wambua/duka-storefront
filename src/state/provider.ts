import { DEFAULT_SCENARIO, isScenarioId, type ScenarioId } from '../gateway/scenarios';
import type { StoreSpec } from '../lib/persist';
import { PROVIDER_IDS, type ProviderId } from '../payment/types';

/**
 * Which backend takes the next M-Pesa payment, and (mock gateway only) how its mock handset behaves.
 * Only these two fields are ever saved. The sandbox acknowledgement is deliberately NOT here: it lives in
 * the checkout page's own state, so it has to be ticked again every time.
 */
export interface ProviderPrefs {
  choice: ProviderId;
  scenario: ScenarioId;
}

export const providerSpec: StoreSpec<ProviderPrefs> = {
  key: 'duka.provider',
  version: 1,
  // The live gateway is the default; the simulator is the offline fallback the shopper can pick.
  initial: () => ({ choice: 'gateway', scenario: DEFAULT_SCENARIO }),
  validate: (d) => {
    if (typeof d !== 'object' || d === null) return null;
    const { choice, scenario } = d as Partial<ProviderPrefs>;
    if (typeof choice !== 'string' || !(PROVIDER_IDS as readonly string[]).includes(choice)) return null;
    return { choice: choice as ProviderId, scenario: isScenarioId(scenario) ? scenario : DEFAULT_SCENARIO };
  },
};
