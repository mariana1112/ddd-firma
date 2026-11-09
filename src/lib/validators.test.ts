import { describe, expect, it } from 'vitest';
import { formatPhoneInput, formatPostalInput } from './validators';

describe('wpisywanie numeru i kodu pocztowego', () => {
  it('telefon w grupach po trzy cyfry', () => {
    expect(formatPhoneInput('500600700')).toBe('500 600 700');
    expect(formatPhoneInput('5006')).toBe('500 6');
    expect(formatPhoneInput('500-600-700')).toBe('500 600 700');
    expect(formatPhoneInput('+48500600700')).toBe('+48 500 600 700');
    expect(formatPhoneInput('+48 500 600 7')).toBe('+48 500 600 7');
    expect(formatPhoneInput('')).toBe('');
  });

  it('kod pocztowy: same cyfry, myślnik po dwóch', () => {
    expect(formatPostalInput('90001')).toBe('90-001');
    expect(formatPostalInput('90')).toBe('90');
    expect(formatPostalInput('900')).toBe('90-0');
    expect(formatPostalInput('90-001')).toBe('90-001');
    expect(formatPostalInput('9a0b0c01xyz7')).toBe('90-001');
  });
});
