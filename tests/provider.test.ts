import { describe, expect, it } from 'vitest';
import { migrateEnvelope } from '../src/lib/persist';
import { providerSpec } from '../src/state/provider';

const load = (data: unknown) => migrateEnvelope({ v: 1, data }, providerSpec);

describe('provider preference', () => {
  it('defaults to the live gateway with the success scenario', () => {
    expect(providerSpec.initial()).toEqual({ choice: 'gateway', scenario: 'success' });
    expect(migrateEnvelope(null, providerSpec)).toEqual({ choice: 'gateway', scenario: 'success' });
  });

  it('persists a saved choice and scenario', () => {
    expect(load({ choice: 'simulator', scenario: 'late_success' })).toEqual({ choice: 'simulator', scenario: 'late_success' });
  });

  it('falls back safely on junk, and on an unknown scenario', () => {
    expect(load({ choice: 'carrier-pigeon' })).toEqual({ choice: 'gateway', scenario: 'success' });
    expect(load('nope')).toEqual({ choice: 'gateway', scenario: 'success' });
    expect(load({ choice: 'simulator', scenario: 'does_not_exist' })).toEqual({ choice: 'simulator', scenario: 'success' });
  });
});
