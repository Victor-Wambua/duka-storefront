import { useEffect, useRef, useState, type ReactNode } from 'react';
import { describeFlags, GATEWAY_FAIL_COPY, SANDBOX_FAIL_COPY } from '../gateway/copy';
import { INSPECTOR_URL } from '../gateway/config';
import { SANDBOX_PENDING_COPY, standInNote } from '../gateway/sandbox';
import { useNow } from '../hooks/useNow';
import { formatKES } from '../lib/money';
import type { ExpiredCheck, PaymentState } from '../payment/machine';
import type { FailReason, ProviderId } from '../payment/types';
import { AlertIcon, CheckIcon, ClockIcon, PhoneIcon } from './Icons';

export const FAIL_COPY: Record<FailReason, { title: string; body: string }> = {
  // Reasons only the live gateway produces fall back to its wording; the simulator never reaches them.
  ...GATEWAY_FAIL_COPY,
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

/** The gateway's identifiers for the payment on screen, so a visitor can find it in the inspector. */
export interface GatewayRefs {
  paymentId: string | null;
  darajaCheckoutId: string | null;
  /** the inspector of the gateway instance that holds the payment (defaults to the mock-Daraja one) */
  inspectorUrl?: string;
}

export interface PaymentPanelProps {
  state: PaymentState;
  /** which backend the payment on screen is going through */
  provider?: ProviderId;
  /** the mock-Daraja scenario chosen for this payment (gateway only) */
  scenarioLabel?: string | null;
  refs?: GatewayRefs | null;
  /** the live gateway's per-payment cap, for the over-cap message */
  capKes?: number;
  onUseSimulator?: () => void;
  /** sandbox only: switch to the mock-Daraja gateway */
  onUseMockGateway?: () => void;
  /** the order total; for the sandbox `amount` is the flat test charge actually sent and this is what it stands in for */
  orderTotal?: number;
  onViewOrder?: () => void;
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

/** Payment id and CheckoutRequestID, plus the link to the gateway inspector (it has no per-payment deep link). */
function InspectLink({ refs }: { refs: GatewayRefs | null | undefined }) {
  if (!refs?.paymentId) return null;
  return (
    <div className="gw-refs" data-testid="gateway-refs">
      <p className="field__hint">
        <a href={refs.inspectorUrl ?? INSPECTOR_URL} target="_blank" rel="noopener noreferrer">
          Inspect this payment<span className="sr-only"> (opens the gateway inspector in a new tab)</span>
        </a>
        . The inspector has no link to a single payment: find it under &ldquo;Recent payments&rdquo; with the ids below.
      </p>
      <dl>
        <div>
          <dt>Payment ID</dt>
          <dd className="num" data-testid="gateway-payment-id">
            {refs.paymentId}
          </dd>
        </div>
        {refs.darajaCheckoutId && (
          <div>
            <dt>CheckoutRequestID</dt>
            <dd className="num" data-testid="gateway-checkout-id">
              {refs.darajaCheckoutId}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** "Try again", held back until the gateway's Retry-After has passed. */
function RetryButton({ seconds, onClick, label = 'Try again' }: { seconds: number; onClick: () => void; label?: string }) {
  const [until] = useState(() => Date.now() + seconds * 1000);
  const now = useNow(1000);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <button type="button" className="btn btn--primary" onClick={onClick} disabled={left > 0}>
      {left > 0 ? `${label} in ${left}s` : label}
    </button>
  );
}

export function PaymentPanel(p: PaymentPanelProps) {
  const { state } = p;
  const sbx = p.provider === 'sandbox';
  /** either deployed gateway instance */
  const gw = p.provider === 'gateway' || sbx;
  const standIn = sbx && p.orderTotal !== undefined && p.orderTotal !== p.amount ? standInNote(p.orderTotal) : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const awaiting = state.status === 'awaiting_customer';
  const now = useNow(awaiting ? 1000 : null);

  const expiredCheck = state.status === 'expired' || state.status === 'review' ? state.check : null;
  // Move focus when the situation changes so keyboard and screen reader users are not left on a removed button.
  useEffect(() => {
    if (state.status === 'failed' || ((state.status === 'expired' || state.status === 'review') && expiredCheck !== 'checking')) {
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
          {sbx
            ? 'Creating the payment on the Safaricom sandbox gateway, which asks Safaricom to send the prompt. This takes a few seconds. Please do not close this page.'
            : gw
            ? 'Creating the payment on the live gateway. This takes a few seconds. Please do not close this page.'
            : 'Contacting M-Pesa. This takes a few seconds. Please do not close this page.'}
        </p>
      </section>
    );
  }

  if (state.status === 'awaiting_customer') {
    const endsAt = state.promptEndsAt ?? state.deadline;
    const remaining = Math.max(0, endsAt - now);
    const total = endsAt - state.startedAt;
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    const bucket = Math.max(15, Math.ceil(remaining / 15000) * 15);
    // The prompt window is over but the gateway has not settled: keep looking, in case a late result arrives.
    const settling = gw && (state.phase === 'late_watch' || (state.promptEndsAt !== undefined && now >= state.promptEndsAt));
    if (gw) {
      return (
        <section className="panel pay" aria-labelledby="pay-h">
          <Icon kind="phone">
            <PhoneIcon size={36} />
          </Icon>
          <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
            Check your phone
          </h2>
          {sbx ? (
            <>
              <p className="pay__lead">
                The gateway asked Safaricom&rsquo;s Daraja sandbox to send an M-Pesa prompt for <strong className="num">{formatKES(p.amount)}</strong> to{' '}
                <strong className="num">{p.phoneDisplay}</strong>.
              </p>
              <p className="pay__lead" role="status" data-testid="sandbox-pending">
                {SANDBOX_PENDING_COPY}
              </p>
              {standIn && (
                <p className="notice notice--info pay__note" data-testid="stand-in-note">
                  {standIn}.
                </p>
              )}
              <p className="notice notice--warn pay__note">
                This is a real prompt. Nothing in this demo has been tested with a PIN, so we cannot promise what approving it does.
              </p>
            </>
          ) : (
            <>
              <p className="pay__lead">
                The gateway asked its mock Daraja to send an M-Pesa prompt for <strong className="num">{formatKES(p.amount)}</strong> to{' '}
                <strong className="num">{p.phoneDisplay}</strong>.
              </p>
              <p className="notice notice--info pay__note">
                This is a demo, so no real prompt reaches your phone and no money moves. The mock Daraja answers by itself
                {p.scenarioLabel ? (
                  <>
                    {' '}
                    as you chose: <strong>{p.scenarioLabel}</strong>
                  </>
                ) : null}
                . Use the Phone simulator button above to pick a different outcome for the next payment.
              </p>
            </>
          )}
          {settling ? (
            <p className="notice notice--warn pay__note" role="status" data-testid="settling">
              The prompt window has closed. The gateway is settling the result and we keep checking in case a late one
              arrives. Please do not {sbx ? 'send another prompt' : 'pay again'}.
            </p>
          ) : (
            <>
              <p className="countdown" aria-hidden="true" data-testid="countdown">
                {fmtClock(remaining)}
              </p>
              <div className="progress" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="sr-only" role="status">
                Waiting for the gateway. About {bucket} seconds left in the prompt window.
              </p>
            </>
          )}
          {!p.online && (
            <p className="notice notice--warn" role="status">
              You are offline. We will keep checking as soon as you are back online. The payment keeps going on the gateway
              without us.
            </p>
          )}
          {state.reused && (
            <p className="notice notice--info">A payment for this order is already in progress, so we did not create a second one.</p>
          )}
          <InspectLink refs={p.refs} />
          <div className="pay__actions" ref={actionsRef}>
            <button type="button" className="btn" onClick={p.onViewOrder}>
              Leave and check later
            </button>
          </div>
          <p className="field__hint">
            Leaving does not stop the payment. Your order stays under Orders, where &ldquo;Check payment status&rdquo; asks the gateway
            again.
          </p>
        </section>
      );
    }
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
          {sbx ? 'Paid (sandbox test)' : 'Payment received'}
        </h2>
        <p className="pay__lead" role="status">
          {sbx ? (
            <>
              The gateway reported this payment as succeeded (M-Pesa receipt <strong>{state.receipt}</strong>). It was a{' '}
              <strong className="num">{formatKES(p.amount)}</strong> sandbox test charge. What a sandbox success does, including whether
              it could debit a real wallet, has not been verified here, so check your own M-Pesa messages. Opening your receipt…
            </>
          ) : gw ? (
            <>
              Thank you. The gateway confirmed <strong className="num">{formatKES(p.amount)}</strong> (M-Pesa receipt{' '}
              <strong>{state.receipt}</strong>, a synthetic receipt from the mock Daraja). Opening your receipt…
            </>
          ) : (
            <>
              Thank you. M-Pesa confirmed <strong className="num">{formatKES(p.amount)}</strong> (receipt{' '}
              <strong>{state.receipt}</strong>, simulated). Opening your receipt…
            </>
          )}
        </p>
        {standIn && (
          <p className="notice notice--info pay__note" data-testid="stand-in-note">
            {standIn}.
          </p>
        )}
        {gw && <InspectLink refs={p.refs} />}
      </section>
    );
  }

  if (state.status === 'failed') {
    const copy = sbx ? SANDBOX_FAIL_COPY[state.reason] : gw ? GATEWAY_FAIL_COPY[state.reason] : FAIL_COPY[state.reason];
    let body = copy.body;
    if (sbx && state.reason === 'declined' && state.detail) body = `Safaricom reported: \u201c${state.detail}\u201d. This payment did not go through.`;
    else if (gw && state.reason === 'declined' && state.detail) body = `Daraja reported: \u201c${state.detail}\u201d. Nothing was charged.`;
    if (gw && state.reason === 'rejected' && state.detail) body = `${body} The gateway said: ${state.detail}`;
    if (!sbx && gw && state.reason === 'over_cap') body = `${body} This order is ${formatKES(p.amount)}; the cap is ${formatKES(p.capKes ?? 1000)}.`;
    const couldNotStart = state.reason === 'unreachable' || state.reason === 'rate_limited' || state.reason === 'over_cap' || state.reason === 'rejected';
    const offerSimulator = gw && couldNotStart;
    // A second real prompt always goes through the checkout form again, where the warning has to be acknowledged afresh.
    const retry = sbx ? p.onChangeNumber : p.onRetry;
    const offerMock = sbx && (couldNotStart || state.reason === 'phone_not_approved');
    return (
      <section className="panel pay" aria-labelledby="pay-h">
        <div role="alert">
          <Icon kind="bad">
            <AlertIcon size={36} />
          </Icon>
          <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
            {copy.title}
          </h2>
          <p className="pay__lead">{body}</p>
        </div>
        {standIn && state.reason !== 'phone_not_approved' && !couldNotStart && (
          <p className="notice notice--info pay__note" data-testid="stand-in-note">
            {standIn}.
          </p>
        )}
        {gw && !(sbx && (couldNotStart || state.reason === 'phone_not_approved')) && <InspectLink refs={p.refs} />}
        <p className="field__hint">Order {p.orderRef} is saved. Trying again will not create a second order.</p>
        <div className="pay__actions" ref={actionsRef}>
          {state.reason === 'over_cap' || state.reason === 'phone_not_approved' ? null : state.reason === 'rate_limited' ? (
            <RetryButton seconds={state.retryAfterSec ?? 30} onClick={retry} label={sbx ? 'Back to checkout' : 'Try again'} />
          ) : (
            <button type="button" className="btn btn--primary" onClick={retry}>
              {sbx ? 'Back to checkout to send a new prompt' : 'Try again'}
            </button>
          )}
          {offerMock && (
            <button
              type="button"
              className={`btn ${state.reason === 'over_cap' || state.reason === 'phone_not_approved' ? 'btn--primary' : ''}`}
              onClick={p.onUseMockGateway}
            >
              Use the mock gateway
            </button>
          )}
          {(offerSimulator || offerMock) && (
            <button type="button" className={`btn ${state.reason === 'over_cap' && !sbx ? 'btn--primary' : ''}`} onClick={p.onUseSimulator}>
              Use the in-browser simulator
            </button>
          )}
          {gw && state.reason === 'timeout' && (
            <button type="button" className="btn" onClick={p.onViewOrder}>
              Check order status
            </button>
          )}
          {state.reason !== 'over_cap' && !(sbx && state.reason !== 'phone_not_approved') && (
            <button type="button" className="btn" onClick={p.onChangeNumber}>
              Use a different number
            </button>
          )}
          <button type="button" className="btn" onClick={p.onPayOnDelivery}>
            {p.pickup ? 'Pay at pickup instead' : 'Pay on delivery instead'}
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'review') {
    const reasons = describeFlags(state.flags);
    const check = state.check;
    return (
      <section className="panel pay" aria-labelledby="pay-h">
        <div role="alert">
          <Icon kind="wait">
            <ClockIcon size={36} />
          </Icon>
          <h2 id="pay-h" ref={headingRef} tabIndex={-1}>
            We are checking this payment
          </h2>
          <p className="pay__lead">
            The gateway has not confirmed or declined it. It got a result it will not trust on its own, so it is holding the payment
            for review instead of guessing.
          </p>
          {reasons.length > 0 && (
            <ul className="pay__reasons" data-testid="review-reasons">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="notice notice--warn pay__note">
          Your order is saved but <strong>not marked as paid</strong>. The payment may still complete, so please do not pay again
          yet. In this demo nobody clears held payments, so it stays held. Your order is under Orders, where &ldquo;Check payment
          status&rdquo; asks the gateway again.
          {sbx && ' This prompt was real, so your own M-Pesa messages are the place to see what actually happened.'}
        </p>
        <InspectLink refs={p.refs} />
        <div role="status" className="pay__lead" style={{ margin: '0.75rem auto' }}>
          {check === 'checking' && <span>Asking the gateway…</span>}
          {check === 'pending' && (
            <span className="notice notice--info" style={{ display: 'block' }}>
              Still held for review. Nothing has changed.
            </span>
          )}
          {check === 'error' && (
            <span className="notice notice--warn" style={{ display: 'block' }}>
              We could not check just now{p.online ? '' : ' (you are offline)'}. Try again in a moment.
            </span>
          )}
        </div>
        <div className="pay__actions" ref={actionsRef}>
          <button type="button" className="btn btn--primary" onClick={p.onCheck} disabled={check === 'checking' || !p.online}>
            Check again
          </button>
          <button type="button" className="btn" onClick={p.onViewOrder}>
            View my order
          </button>
          <button type="button" className="btn" onClick={p.onPayOnDelivery}>
            {p.pickup ? 'Pay at pickup instead' : 'Pay on delivery instead'}
          </button>
        </div>
        <p className="field__hint">Paying on delivery does not cancel the held payment: the gateway has no cancel.</p>
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
          {gw ? 'We have not heard back from the gateway' : 'We have not heard back from M-Pesa'}
        </h2>
        <p className="pay__lead">
          If you entered your PIN, the payment may still be on its way. <strong>Please do not pay again yet.</strong> Check the
          status first.
        </p>
      </div>
      <div role="status" className="pay__lead" style={{ margin: '0.75rem auto' }}>
        {check === 'checking' && <span>{gw ? 'Asking the gateway…' : 'Checking with M-Pesa…'}</span>}
        {check === 'pending' && (
          <span className="notice notice--info" style={{ display: 'block' }}>
            {gw
              ? 'Still processing on the gateway. Wait a moment and check again.'
              : 'Still processing. Wait a moment and check again. If you got an M-Pesa confirmation SMS, keep it.'}
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
      {gw && <InspectLink refs={p.refs} />}
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
