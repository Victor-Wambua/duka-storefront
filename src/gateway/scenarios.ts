/**
 * The gateway's mock Daraja behaves deterministically per `scenario`. These are the
 * choices behind the Phone simulator when the live gateway is the provider.
 */
export const SCENARIO_IDS = [
  'success',
  'insufficient_funds',
  'wrong_pin',
  'cancelled_by_user',
  'timeout_no_callback',
  'duplicate_callback',
  'late_success',
  'callback_then_query_disagree',
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const DEFAULT_SCENARIO: ScenarioId = 'success';

export interface ScenarioInfo {
  id: ScenarioId;
  label: string;
  /** one line: what the mock does and how the payment ends */
  hint: string;
}

export const SCENARIOS: ScenarioInfo[] = [
  {
    id: 'success',
    label: 'Customer pays',
    hint: 'A success callback arrives in about 3 seconds and the gateway verifies it. The payment succeeds.',
  },
  {
    id: 'insufficient_funds',
    label: 'Insufficient funds',
    hint: 'Balance too low (result code 1). The payment fails.',
  },
  {
    id: 'wrong_pin',
    label: 'Wrong PIN',
    hint: 'The PIN is rejected (result code 2001). The payment fails.',
  },
  {
    id: 'cancelled_by_user',
    label: 'Customer cancels',
    hint: 'The customer dismisses the prompt (result code 1032). The payment is cancelled.',
  },
  {
    id: 'timeout_no_callback',
    label: 'Prompt times out (no callback)',
    hint: 'No callback ever arrives. After about a minute the gateway asks Daraja, learns it timed out, and marks it timed out.',
  },
  {
    id: 'duplicate_callback',
    label: 'Duplicate callback',
    hint: 'The success callback is delivered twice. The gateway records one payment and ignores the replay.',
  },
  {
    id: 'late_success',
    label: 'Late success',
    hint: 'Success arrives after the gateway already timed the payment out. It is held for review, never marked paid. Takes about two minutes.',
  },
  {
    id: 'callback_then_query_disagree',
    label: 'Callback and query disagree',
    hint: 'The callback says success but the verifying query says failed. The gateway trusts the query and holds it for review.',
  },
];

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === 'string' && (SCENARIO_IDS as readonly string[]).includes(v);
}

export function scenarioInfo(id: string): ScenarioInfo | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
