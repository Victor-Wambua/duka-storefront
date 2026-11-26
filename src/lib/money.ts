/** All money in this app is a whole number of Kenyan shillings. */

export function assertShillings(n: number, what = 'amount'): number {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`${what} must be a whole number of shillings, got ${n}`);
  }
  return n;
}

/** 1250 -> "KES 1,250". Never shows decimals; there are none to show. */
export function formatKES(n: number): string {
  assertShillings(n);
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}KES\u00a0${digits}`;
}
