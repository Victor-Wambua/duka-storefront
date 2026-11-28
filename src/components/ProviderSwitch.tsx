import { useId } from 'react';
import type { ProviderId } from '../payment/types';

interface Props {
  value: ProviderId;
  onChange: (p: ProviderId) => void;
  disabled?: boolean;
  /** legend text */
  legend?: string;
}

/** Choose where the next M-Pesa payment goes: the live gateway or the in-browser simulator. */
export function ProviderSwitch({ value, onChange, disabled, legend = 'Where the payment is processed' }: Props) {
  const name = useId();
  return (
    <fieldset className="provider" disabled={disabled}>
      <legend className="field__label">{legend}</legend>
      <label className="radio-card">
        <input type="radio" name={name} checked={value === 'gateway'} onChange={() => onChange('gateway')} />
        <span>
          <strong>Live gateway</strong>
          <small>Creates the payment through the deployed sandbox gateway. A mock Daraja answers. Needs a connection.</small>
        </span>
      </label>
      <label className="radio-card">
        <input type="radio" name={name} checked={value === 'simulator'} onChange={() => onChange('simulator')} />
        <span>
          <strong>In-browser simulator</strong>
          <small>Everything runs in this browser and no request leaves it. Works offline.</small>
        </span>
      </label>
    </fieldset>
  );
}
