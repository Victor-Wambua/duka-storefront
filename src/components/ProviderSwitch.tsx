import { useId } from 'react';
import { SANDBOX_LABEL } from '../gateway/sandbox';
import type { ProviderId } from '../payment/types';

interface Props {
  value: ProviderId;
  onChange: (p: ProviderId) => void;
  disabled?: boolean;
  /** legend text */
  legend?: string;
}

/** Choose where the next M-Pesa payment goes: the mock-Daraja gateway, the in-browser simulator, or the Safaricom sandbox. */
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
      <label className="radio-card">
        <input type="radio" name={name} checked={value === 'sandbox'} onChange={() => onChange('sandbox')} />
        <span>
          <strong>{SANDBOX_LABEL}</strong>
          <small>Safaricom&rsquo;s own Daraja sandbox, through a second deployed gateway. Opt-in: a KES 1 test charge, and a real prompt goes to the number you enter.</small>
        </span>
      </label>
    </fieldset>
  );
}
