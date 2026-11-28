import { DEFAULT_SCENARIO, isScenarioId, type ScenarioId } from '../gateway/scenarios';
import type { StoreSpec } from '../lib/persist';
import type { ProviderId } from '../payment/types';

/** Which backend takes the next M-Pesa payment, and (gateway only) how its mock handset behaves. */
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
    if (choice !== 'gateway' && choice !== 'simulator') return null;
    return { choice, scenario: isScenarioId(scenario) ? scenario : DEFAULT_SCENARIO };
  },
};
