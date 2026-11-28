import { useEffect, useId, useRef } from 'react';
import { ProviderSwitch } from '../components/ProviderSwitch';
import { SCENARIOS, scenarioInfo, type ScenarioId } from '../gateway/scenarios';
import { useNow } from '../hooks/useNow';
import { formatKES } from '../lib/money';
import { maskPhone } from '../lib/phone';
import { providerStore, resetDemoData, useStore } from '../state/stores';
import { DEFAULT_SIM, mockMpesa, type Decision, type SimOutcome } from './mpesaMock';

const OUTCOMES: { id: SimOutcome; label: string; hint: string }[] = [
  { id: 'success', label: 'Customer pays', hint: 'Accepts and enters the right PIN after the delay.' },
  { id: 'cancelled', label: 'Customer cancels', hint: 'Dismisses the prompt (code 1032).' },
  { id: 'wrong_pin', label: 'Wrong PIN', hint: 'Enters an incorrect PIN (code 2001).' },
  { id: 'insufficient_funds', label: 'Insufficient funds', hint: 'Balance too low (code 1).' },
  { id: 'timeout', label: 'Prompt times out', hint: 'Safaricom reports the prompt timed out (code 1037).' },
  { id: 'unreachable', label: 'Cannot reach M-Pesa', hint: 'The request fails before a prompt is sent.' },
  { id: 'delayed_paid', label: 'Paid, but status is late', hint: 'Money moves; the status check stays "pending". Use "Check payment status" to recover.' },
  { id: 'silent', label: 'Never answers', hint: 'No reply at all. The shop stops waiting; a lookup finds no payment.' },
  { id: 'manual', label: 'I will answer on the phone', hint: 'Use the simulated handset below.' },
];

const DECISIONS: { id: Decision; label: string }[] = [
  { id: 'success', label: 'Enter correct PIN' },
  { id: 'wrong_pin', label: 'Enter wrong PIN' },
  { id: 'insufficient_funds', label: 'No balance' },
  { id: 'cancelled', label: 'Cancel' },
];

/**
 * Demo overlay: choose how the next M-Pesa prompt ends, or play the customer on
 * a simulated handset. This stands in for a real phone, which a reviewer
 * cannot hold, so every payment state can be seen.
 */
export default function PhoneSimulator({ id: panelId, onClose }: { id: string; onClose: () => void }) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Non-modal on purpose: you answer the simulated prompt while the checkout stays visible.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.show();
    headingRef.current?.focus();
    // Escape closes the panel wherever focus is, unless the cart drawer is on top of it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog.drawer[open]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sim = useStore(mockMpesa.sim);
  const prefs = useStore(providerStore);
  const gateway = prefs.choice === 'gateway';
  const sandbox = prefs.choice === 'sandbox';
  useStore(mockMpesa.server);
  const now = useNow(500);
  const prompts = mockMpesa.livePrompts();
  const current = OUTCOMES.find((o) => o.id === sim.outcome);

  return (
    <dialog
      ref={ref}
      className="sim no-print"
      id={panelId}
      aria-labelledby={`${id}-title`}
    >
      <div className="sim__head">
        <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1}>
          Phone simulator
        </h2>
        <button type="button" className="btn btn--sm" onClick={onClose}>
          Close<span className="sr-only"> phone simulator</span>
        </button>
      </div>
      <>
          <p className="sim__note">
            Demo controls. Choose where the next M-Pesa payment goes and, for the two providers that can pretend, what the
            customer does when the prompt arrives. Settings apply to the next request.
          </p>
          <ProviderSwitch value={prefs.choice} onChange={(choice) => providerStore.set((p) => ({ ...p, choice }))} legend="Process the next payment with" />
          {gateway ? (
            <div className="field sim__scenario">
              <label className="field__label" htmlFor={`${id}-scenario`}>
                What the mock Daraja does next
              </label>
              <select
                id={`${id}-scenario`}
                value={prefs.scenario}
                onChange={(e) => providerStore.set((p) => ({ ...p, scenario: e.target.value as ScenarioId }))}
              >
                {SCENARIOS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="field__hint" data-testid="scenario-hint">
                {scenarioInfo(prefs.scenario)?.hint}
              </span>
              <span className="field__hint">
                The live gateway sets the timing, so there is no delay or handset here. Nothing is sent to a real phone and no money
                moves.
              </span>
            </div>
          ) : sandbox ? (
            <div className="field sim__scenario" data-testid="sandbox-no-scenario">
              <p className="field__hint">
                Safaricom&rsquo;s real Daraja sandbox decides how each prompt ends, so there is no outcome to pick here and nothing in this
                panel can change it. You answer on your own phone. A cancelled prompt, a prompt nobody answers and two KES 1 payments completed
                with a PIN are the real results seen so far; whether a success debits a real wallet has not been checked. Every sandbox payment is a flat KES 1 test charge.
              </p>
            </div>
          ) : (
          <>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-outcome`}>
              What happens to the next payment
            </label>
            <select id={`${id}-outcome`} value={sim.outcome} onChange={(e) => mockMpesa.sim.set({ ...sim, outcome: e.target.value as SimOutcome })}>
              {OUTCOMES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="field__hint">{current?.hint}</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-delay`}>
              Customer answers after: {sim.delaySec}s
            </label>
            <input
              id={`${id}-delay`}
              type="range"
              min={1}
              max={30}
              value={sim.delaySec}
              disabled={sim.outcome === 'manual'}
              onChange={(e) => mockMpesa.sim.set({ ...sim, delaySec: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-window`}>
              Shop stops waiting after
            </label>
            <select id={`${id}-window`} value={sim.windowSec} onChange={(e) => mockMpesa.sim.set({ ...sim, windowSec: Number(e.target.value) })}>
              <option value={15}>15 seconds (quick demo of expiry)</option>
              <option value={30}>30 seconds</option>
              <option value={75}>75 seconds (default)</option>
            </select>
          </div>

          <div className="handset" role="group" aria-label="Simulated handset">
            <div className="handset__screen">
              <div className="handset__app">M-PESA (simulated)</div>
              {prompts.length === 0 ? (
                <p className="handset__idle">No payment request yet.</p>
              ) : (
                prompts.map((r) => {
                  const left = Math.max(0, Math.ceil(((r.resolveAt ?? 0) - now) / 1000));
                  return (
                    <div key={r.id}>
                      <p style={{ margin: '0.5rem 0' }}>
                        Pay <strong>{formatKES(r.amount)}</strong> to MAMA LUCY&rsquo;S PROVISIONS from {maskPhone(r.msisdn)}? Enter PIN.
                      </p>
                      {r.outcome === 'manual' ? (
                        <div className="handset__btns">
                          {DECISIONS.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              className={`btn ${d.id === 'success' ? 'btn--primary' : ''}`}
                              onClick={() => mockMpesa.handsetRespond(r.id, d.id)}
                            >
                              {d.label}
                            </button>
                          ))}
                          <p className="sim__note" style={{ color: '#aab4bf' }}>
                            Or leave it alone and the prompt will time out.
                          </p>
                        </div>
                      ) : (
                        <p style={{ color: '#aab4bf', fontSize: '0.8125rem', margin: 0 }}>
                          {r.outcome === 'silent' ? 'Customer is ignoring this prompt.' : `Customer responds in ${left}s (${r.outcome.replace('_', ' ')}).`}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          </>
          )}

          <button
            type="button"
            className="btn btn--sm btn--block"
            onClick={() => {
              mockMpesa.reset();
              mockMpesa.sim.set({ ...DEFAULT_SIM });
              resetDemoData();
            }}
          >
            Reset demo data (cart, orders, stock)
          </button>
      </>
    </dialog>
  );
}
