/**
 * One Idempotency-Key per checkout attempt (8-128 printable characters, as the gateway requires).
 * The same key with the same body returns the same payment, so a double click or a reload that
 * re-sends the request cannot create a second one.
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `duka-${c.randomUUID()}`;
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return `duka-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
