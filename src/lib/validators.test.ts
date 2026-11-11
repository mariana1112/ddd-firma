import { describe, expect, it } from 'vitest';
import { formatPhoneInput, formatPostalInput, phoneError, withCountryCode } from './validators';

describe('wpisywanie numeru i kodu pocztowego', () => {
  it('telefon zawsze z +48, w grupach po trzy cyfry, bez za długich numerów', () => {
    expect(formatPhoneInput('500600700')).toBe('+48 500 600 700');
    expect(formatPhoneInput('5006')).toBe('+48 500 6');
    expect(formatPhoneInput('500-600-700')).toBe('+48 500 600 700');
    expect(formatPhoneInput('+48500600700')).toBe('+48 500 600 700');
    expect(formatPhoneInput('+48 500 600 7')).toBe('+48 500 600 7');
    expect(formatPhoneInput('0048500600700')).toBe('+48 500 600 700');
    expect(formatPhoneInput('48500600700')).toBe('+48 500 600 700');
    // 15 cyfr: polski numer zostaje ucięty do 9 cyfr po +48.
    expect(formatPhoneInput('500600700123456')).toBe('+48 500 600 700');
    // Numer zagraniczny zostaje z własnym kierunkowym; „+” i „+4” w trakcie wpisywania nie znikają.
    expect(formatPhoneInput('+442079460958')).toBe('+44 207 946 095 8');
    expect(formatPhoneInput('+4')).toBe('+4');
    expect(formatPhoneInput('+48')).toBe('+48');
    expect(formatPhoneInput('')).toBe('');
  });

  it('błędny numer: za mało cyfr po +48', () => {
    expect(phoneError('500 600 70')).toBe('Numer musi mieć 9 cyfr po +48 (np. +48 500 600 700)');
    expect(phoneError('500600700')).toBeUndefined();
    expect(phoneError('')).toBeUndefined();
    expect(withCountryCode('573 324 034')).toBe('+48 573 324 034');
  });

  it('kod pocztowy: same cyfry, myślnik po dwóch', () => {
    expect(formatPostalInput('90001')).toBe('90-001');
    expect(formatPostalInput('90')).toBe('90');
    expect(formatPostalInput('900')).toBe('90-0');
    expect(formatPostalInput('90-001')).toBe('90-001');
    expect(formatPostalInput('9a0b0c01xyz7')).toBe('90-001');
  });
});
