export type PhoneFailure = 'empty' | 'invalid_chars' | 'bad_prefix' | 'too_short' | 'too_long';

export type PhoneResult =
  | {
      ok: true;
      /** 2547XXXXXXXX / 2541XXXXXXXX, the format M-Pesa APIs expect */
      msisdn: string;
      /** 0712345678 */
      national: string;
      /** 0712 345 678 */
      display: string;
    }
  | { ok: false; reason: PhoneFailure };

const ALLOWED = /^\+?[\d\s\-().]*$/;

/**
 * Normalise a Kenyan mobile number typed in any common way:
 * 0712 345 678, 0112345678, 712345678, +254712345678, 254712345678,
 * 00254712345678, and the +2540712345678 slip people make.
 *
 * It checks structure (9 digits starting 7 or 1), not operator prefix ranges:
 * those change with number portability and new allocations.
 */
export function normalisePhone(input: string): PhoneResult {
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'empty' };
  if (!ALLOWED.test(raw) || raw.indexOf('+') > 0) return { ok: false, reason: 'invalid_chars' };

  let digits = raw.replace(/\D/g, '');
  if (digits === '') return { ok: false, reason: 'invalid_chars' };

  if (digits.startsWith('00254')) digits = digits.slice(2);
  let rest: string;
  if (digits.startsWith('254')) {
    rest = digits.slice(3);
    // +254 0712...: the trunk zero is not part of an international number
    if (rest.startsWith('0')) rest = rest.slice(1);
  } else if (digits.startsWith('0')) {
    rest = digits.slice(1);
  } else {
    rest = digits;
  }

  if (rest === '') return { ok: false, reason: 'too_short' };
  if (rest[0] !== '7' && rest[0] !== '1') return { ok: false, reason: 'bad_prefix' };
  if (rest.length < 9) return { ok: false, reason: 'too_short' };
  if (rest.length > 9) return { ok: false, reason: 'too_long' };

  const national = `0${rest}`;
  return {
    ok: true,
    msisdn: `254${rest}`,
    national,
    display: `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`,
  };
}

export function phoneMessage(reason: PhoneFailure): string {
  switch (reason) {
    case 'empty':
      return 'Enter the M-Pesa number that will receive the payment prompt.';
    case 'invalid_chars':
      return 'Use digits only. A leading + is fine.';
    case 'bad_prefix':
      return 'Kenyan mobile numbers start with 07 or 01 (or +254 7 / +254 1).';
    case 'too_short':
      return 'That number looks too short. It should be 10 digits, like 0712 345 678.';
    case 'too_long':
      return 'That number looks too long. It should be 10 digits, like 0712 345 678.';
  }
}

/** Mask for receipts and lists: 0712 345 678 -> 0712 *** 678 */
export function maskPhone(msisdn: string): string {
  const r = normalisePhone(msisdn);
  if (!r.ok) return '****';
  return `${r.national.slice(0, 4)} *** ${r.national.slice(7)}`;
}
