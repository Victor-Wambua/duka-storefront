import { useEffect, useRef, useState } from 'react';
import { PaymentController, type ControllerOptions } from '../payment/controller';
import { initialPayment, type PaymentState } from '../payment/machine';
import { useOnline } from './useOnline';

/**
 * Owns one PaymentController for the lifetime of the component. It is created
 * inside an effect so React StrictMode's mount/unmount/mount cycle does not
 * leave us holding a disposed instance.
 */
export function usePaymentController(opts: Omit<ControllerOptions, 'onChange'>, onReady?: (c: PaymentController) => void) {
  const [state, setState] = useState<PaymentState>(initialPayment);
  const ref = useRef<PaymentController | null>(null);
  const optsRef = useRef(opts);
  const readyRef = useRef(onReady);
  useEffect(() => {
    optsRef.current = opts;
    readyRef.current = onReady;
  });
  const online = useOnline();

  useEffect(() => {
    const c = new PaymentController({
      ...optsRef.current,
      onAttempt: (info) => optsRef.current.onAttempt?.(info),
      onChange: setState,
    });
    ref.current = c;
    setState(c.getState());
    readyRef.current?.(c);
    return () => {
      c.dispose();
      ref.current = null;
    };
  }, []);

  useEffect(() => {
    ref.current?.setOnline(online);
  }, [online, state.status]);

  return { state, controller: ref };
}
