import { describe, expect, it } from 'vitest';
import { maskPhone, normalisePhone, phoneMessage } from '../src/lib/phone';

describe('normalisePhone: accepted formats', () => {
  it.each([
    '0712345678',
    '0712 345 678',
    '0712-345-678',
    '(0712) 345 678',
    '712345678',
    '+254712345678',
    '+254 712 345 678',
    '254712345678',
    '00254712345678',
    '+2540712345678', // the trunk-zero slip
    '  0712345678  ',
  ])('%s -> 254712345678', (input) => {
    const r = normalisePhone(input);
    expect(r).toMatchObject({ ok: true, msisdn: '254712345678', national: '0712345678', display: '0712 345 678' });
  });

  it('accepts the 01xx range', () => {
    expect(normalisePhone('0110 000 001')).toMatchObject({ ok: true, msisdn: '254110000001', display: '0110 000 001' });
    expect(normalisePhone('+254110000001')).toMatchObject({ ok: true, msisdn: '254110000001' });
  });
});

describe('normalisePhone: rejections', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'invalid_chars'],
    ['0712abc678', 'invalid_chars'],
    ['07123+45678', 'invalid_chars'],
    ['+', 'invalid_chars'],
    ['0212345678', 'bad_prefix'], // landline-style
    ['0912345678', 'bad_prefix'],
    ['+255712345678', 'bad_prefix'], // Tanzania
    ['071234567', 'too_short'],
    ['0', 'too_short'],
    ['+254', 'too_short'],
    ['07123456789', 'too_long'],
    ['+2547123456789', 'too_long'],
  ])('%j -> %s', (input, reason) => {
    expect(normalisePhone(input)).toEqual({ ok: false, reason });
  });

  it('has a human message for every reason', () => {
    for (const r of ['empty', 'invalid_chars', 'bad_prefix', 'too_short', 'too_long'] as const) {
      expect(phoneMessage(r).length).toBeGreaterThan(10);
    }
  });
});

describe('maskPhone', () => {
  it('hides the middle digits', () => {
    expect(maskPhone('254712345678')).toBe('0712 *** 678');
    expect(maskPhone('garbage')).toBe('****');
  });
});
