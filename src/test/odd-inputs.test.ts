// Nietypowe dane wpisywane w pola: kwoty, telefony, NIP, znaki specjalne i emoji w szukaniu.
import { describe, expect, it } from 'vitest';
import { moneyToInput, parseMoney } from '../lib/money';
import { formatPhoneInput, formatPostalInput, isValidNip, phoneError } from '../lib/validators';
import { orderMatches } from '../data/order-search';
import { floorText } from '../data/texts';
import { streetName } from '../data/geo';

describe('nietypowe dane', () => {
  it('kwoty: odstępy, „zł”, kropka i przecinek; ujemne i tekst odrzucone', () => {
    expect(parseMoney('1 000,50')).toBe(100050);
    expect(parseMoney('1000.5')).toBe(100050);
    expect(parseMoney('350 zł')).toBe(35000);
    expect(parseMoney(' 350 ')).toBe(35000);
    expect(parseMoney('-50')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('3,999')).toBeNull();
    expect(moneyToInput(43050)).toBe('430,50');
  });

  it('telefony: nawiasy, myślniki, 0048, dopisek; za krótki z błędem', () => {
    expect(formatPhoneInput('+48 (600) 700-800')).toBe('+48 600 700 800');
    expect(formatPhoneInput('0048600700800')).toBe('+48 600 700 800');
    expect(formatPhoneInput('600 700 800 tata')).toBe('+48 600 700 800');
    expect(phoneError(formatPhoneInput('60070080'))).toBeTruthy();
    expect(phoneError(formatPhoneInput('+49 1512 3456789'))).toBeUndefined();
  });

  it('NIP: myślniki i „PL” przyjęte, same zera nie', () => {
    expect(isValidNip('123-456-32-18')).toBe(true);
    expect(isValidNip('PL1234563218')).toBe(true);
    expect(isValidNip('pl 123 456 32 18')).toBe(true);
    expect(isValidNip('0000000000')).toBe(false);
    expect(isValidNip('1234563219')).toBe(false);
    expect(formatPostalInput('80001')).toBe('80-001');
  });

  it('szukanie ze znakami specjalnymi i emoji nie wywraca listy', () => {
    const o = { id: 'x', number: 7, prefix: 'GDA', clientName: 'Jan (Kowalski) <b>', street: 'Długa*', houseNo: '5', flatNo: '', building: 'dom', city: 'Gdańsk', postalCode: '', pest: 'karaluchy', pestOther: '', phones: [{ number: '+48 600 700 800', label: '' }], invoice: 'brak', protocol: false } as never;
    for (const q of ['(', '*', String.fromCharCode(92), '[', '🐞', '<b>', '%', '?', '$']) expect(() => orderMatches(o, q)).not.toThrow();
    expect(orderMatches(o, 'kowalski')).toBe(true);
    expect(orderMatches(o, 'dluga')).toBe(true);
    expect(orderMatches(o, '600700')).toBe(true);
    expect(orderMatches(o, 'GDA-0007')).toBe(true);
  });

  it('piętro i ulica w nietypowym zapisie', () => {
    expect(floorText('-1')).toBe('piętro -1');
    expect(streetName('ul. 3 Maja 5')).toBe('3 Maja');
    expect(streetName('Aleja Grunwaldzka 100/5')).toBe('Aleja Grunwaldzka');
  });
});
