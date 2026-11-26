import { useEffect, useRef, type ReactNode } from 'react';
import { useNow } from '../hooks/useNow';
import { formatKES } from '../lib/money';
import type { ExpiredCheck, PaymentState } from '../payment/machine';
import type { FailReason } from '../payment/types';
import { AlertIcon, CheckIcon, ClockIcon, PhoneIcon } from './Icons';

export const FAIL_COPY: Record<FailReason, { title: string; body: string }> = {
  cancelled: {
    title: 'Payment cancelled',
    body: 'The payment request was cancelled, so nothing was charged. You can send a new request when you are ready.',
  },
  wrong_pin: {
    title: 'M-Pesa did not accept the PIN',
    body: 'The PIN was wrong, so nothing was charged. Try again and enter your PIN carefully. Several wrong PINs in a row can lock M-Pesa on your SIM.',
  },
  insufficient_funds: {
    title: 'Not enough M-Pesa balance',
    body: 'Your M-Pesa balance is lower than the order total, so nothing was charged. Top up and try again, or choose pay on delivery.',
  },
  timeout: {
    title: 'The request timed out',
    body: 'The prompt expired before it was answered, so nothing was charged. Keep your phone nearby and try again.',
  },
  unreachable: {
    title: 'We could not reach M-Pesa',
    body: 'The request did not go through (network, or the number could not be reached). Nothing was charged. Check your connection and the number, then try again.',
  },
};

export interface PaymentPanelProps {
  state: PaymentState;
  phoneDisplay: string;
  amount: number;
  orderRef: string | null;
  online: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onCheck: () => void;
  onChangeNumber: () => void;
  onPayOnDelivery: () => void;
  pickup: boolean;
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Icon({ kind, children }: { kind: 'ok' | 'bad' | 'wait' | 'phone'; children: ReactNode }) {
  return (
    <div className={`pay__icon ${kind === 'ok' ? 'pay__icon--ok' : kind === 'bad' ? 'pay__icon--bad' : kind === 'wait' ? 'pay__icon--wait' : ''}`} aria-hidden="true">
      {children}
    </div>
  );
}

export function PaymentPanel(p: PaymentPanelProps) {
  const { state } = p;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const awaiting = state.status === 'awaiting_customer';
  const now = useNow(awaiting ? 1000 : null);

  const expiredCheck = state.status === 'expired' ? state.check : null;
  // Move focus when the situation changes so keyboard and screen reader users are not left on a removed button.
  useEffect(() => {
    if (state.status === 'failed' || (state.status === 'expired' && expiredCheck !== 'checking')) {
      const first = actionsRef.current?.querySelector<HTMLElement>('button');
      (first ?? headingRef.current)?.focus();
    } else if (state.status !== 'idle') {
      headingRef.current?.focus();
    }
  }, [state.status, expiredCheck]);

  if (state.status === 'idle') return null;

  if (state.status === 'requesting') {
    return (
      <section className="panel pay" aria-labelledby="pay-h">
        <Icon kind="wait">
          <span className="spinner" />
        </Icon>
        <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
          Sending your payment request
        </h2>
        <p className="pay__lead" role="status">
          Contacting M-Pesa. This takes a few seconds. Please do not close this page.
        </p>
      </section>
    );
  }

  if (state.status === 'awaiting_customer') {
    const remaining = Math.max(0, state.deadline - now);
    const total = state.deadline - state.startedAt;
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    const bucket = Math.max(15, Math.ceil(remaining / 15000) * 15);
    return (
      <section className="panel pay" aria-labelledby="pay-h">
        <Icon kind="phone">
          <PhoneIcon size={36} />
        </Icon>
        <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
          Check your phone
        </h2>
        <p className="pay__lead">
          We sent an M-Pesa prompt to <strong className="num">{p.phoneDisplay}</strong>. Enter your M-Pesa PIN to pay{' '}
          <strong className="num">{formatKES(p.amount)}</strong> to Mama Lucy&rsquo;s.
        </p>
        <p className="countdown" aria-hidden="true" data-testid="countdown">
          {fmtClock(remaining)}
        </p>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="sr-only" role="status">
          Waiting for you to approve the payment on your phone. About {bucket} seconds left.
        </p>
        {!p.online && (
          <p className="notice notice--warn" role="status">
            You are offline. We will keep checking as soon as you are back online. If you already approved the payment,
            it still went through.
          </p>
        )}
        {state.reused && (
          <p className="notice notice--info">A prompt for this order is already on your phone, so we did not send a second one.</p>
        )}
        <p className="field__hint" style={{ maxWidth: '36rem', margin: '0 auto' }}>
          No prompt? Check that your phone is on and has network. Do not pay twice: the result will appear here by itself.
        </p>
        <div className="pay__actions" ref={actionsRef}>
          <button type="button" className="btn" onClick={p.onCancel}>
            Cancel payment
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'paid') {
    return (
      <section className="panel pay" aria-labelledby="pay-h">
        <Icon kind="ok">
          <CheckIcon size={36} />
        </Icon>
        <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
          Payment received
        </h2>
        <p className="pay__lead" role="status">
          Thank you. M-Pesa confirmed <strong className="num">{formatKES(p.amount)}</strong> (receipt{' '}
          <strong>{state.receipt}</strong>, simulated). Opening your receipt…
        </p>
      </section>
    );
  }

  if (state.status === 'failed') {
    const copy = FAIL_COPY[state.reason];
    return (
      <section className="panel pay" aria-labelledby="pay-h">
        <div role="alert">
          <Icon kind="bad">
            <AlertIcon size={36} />
          </Icon>
          <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
            {copy.title}
          </h2>
          <p className="pay__lead">{copy.body}</p>
        </div>
        <p className="field__hint">Order {p.orderRef} is saved. Trying again will not create a second order.</p>
        <div className="pay__actions" ref={actionsRef}>
          <button type="button" className="btn btn--primary" onClick={p.onRetry}>
            Try again
          </button>
          <button type="button" className="btn" onClick={p.onChangeNumber}>
            Use a different number
          </button>
          <button type="button" className="btn" onClick={p.onPayOnDelivery}>
            {p.pickup ? 'Pay at pickup instead' : 'Pay on delivery instead'}
          </button>
        </div>
      </section>
    );
  }

  // expired
  const check = state.check as ExpiredCheck;
  return (
    <section className="panel pay" aria-labelledby="pay-h">
      <div role="alert">
        <Icon kind="wait">
          <ClockIcon size={36} />
        </Icon>
        <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
          We have not heard back from M-Pesa
        </h2>
        <p className="pay__lead">
          If you entered your PIN, the payment may still be on its way. <strong>Please do not pay again yet.</strong> Check the
          status first.
        </p>
      </div>
      <div role="status" className="pay__lead" style={{ margin: '0.75rem auto' }}>
        {check === 'checking' && <span>Checking with M-Pesa…</span>}
        {check === 'pending' && (
          <span className="notice notice--info" style={{ display: 'block' }}>
            Still processing. Wait a moment and check again. If you got an M-Pesa confirmation SMS, keep it.
          </span>
        )}
        {check === 'not_found' && (
          <span className="notice notice--ok" style={{ display: 'block' }}>
            No payment was found for order {p.orderRef} on {p.phoneDisplay}. It is safe to try again.
          </span>
        )}
        {check === 'error' && (
          <span className="notice notice--warn" style={{ display: 'block' }}>
            We could not check just now{p.online ? '' : ' (you are offline)'}. Try again in a moment.
          </span>
        )}
      </div>
      <div className="pay__actions" ref={actionsRef}>
        {check !== 'not_found' ? (
          <button type="button" className="btn btn--primary" onClick={p.onCheck} disabled={check === 'checking' || !p.online}>
            {check === 'pending' || check === 'error' ? 'Check again' : 'Check payment status'}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--primary" onClick={p.onRetry}>
              Send a new prompt
            </button>
            <button type="button" className="btn" onClick={p.onChangeNumber}>
              Use a different number
            </button>
            <button type="button" className="btn" onClick={p.onPayOnDelivery}>
              {p.pickup ? 'Pay at pickup instead' : 'Pay on delivery instead'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
