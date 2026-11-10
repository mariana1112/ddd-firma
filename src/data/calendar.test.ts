import { describe, expect, it } from 'vitest';
import { googleCalendarUrl } from './calendar';
import type { Order } from './types';

const order = {
  number: 44,
  prefix: 'TEST',
  clientName: 'Jan Kowalski',
  pest: 'pluskwy',
  pestOther: '',
  street: 'Zakopiańska',
  houseNo: '18',
  flatNo: '31',
  building: 'blok',
  city: 'Gdańsk',
  postalCode: '80-142',
  phones: [{ number: '+48 573 324 034', label: '' }],
  invoice: 'vat',
  invoiceName: 'Apt Production sp. z o.o.',
  nip: '583-353-41-94',
  invoiceAddress: '',
  email: 'biuro@apt.pl',
  description: 'Mieszkanie uszczelnione.',
  access: '',
  priceMin: 60000,
  priceMax: 60000,
} as unknown as Order;

describe('Kalendarz Google', () => {
  it('wpis jak w kalendarzu firmy: zabieg, szkodnik, cena netto, zakres, telefon; bez kwoty pobranej', () => {
    const url = new URL(googleCalendarUrl(order, { seq: 2, start: '2026-10-26T08:00', durationMin: 90, scope: { kind: 'calosc', note: '' } })!);
    expect(url.searchParams.get('text')).toBe('II pluskwy 600 Netto full, +48 573 324 034');
    expect(url.searchParams.get('dates')).toBe('20261026T080000/20261026T093000');
    expect(url.searchParams.get('location')).toBe('Zakopiańska 18, 80-142 Gdańsk, Polska');
    expect(url.searchParams.get('details')!.split('\n')).toEqual([
      'Mieszkania 31 , +48 573 324 034',
      'Zakopiańska 18/31',
      'Poniedziałek 26.10',
      '8.00',
      '',
      'Dane do faktury',
      'NIP:5833534194',
      'Apt Production sp. z o.o.',
      'biuro@apt.pl',
      '',
      'Opis: Mieszkanie uszczelnione.',
      '',
      'Zlecenie TEST-0044/II',
    ]);
  });

  it('widełki, pokój, bez faktury; bez terminu nie ma linku', () => {
    const plain = { ...order, invoice: 'brak', building: 'dom', flatNo: '', priceMin: 30000, priceMax: 45000 } as Order;
    const url = new URL(googleCalendarUrl(plain, { seq: 1, start: '2026-11-10T10:00', durationMin: 60, scope: { kind: 'pokoj', note: 'sypialnia' } })!);
    expect(url.searchParams.get('text')).toBe('I pluskwy 300-450 sypialnia, +48 573 324 034');
    expect(url.searchParams.get('details')).not.toContain('Dane do faktury');
    expect(googleCalendarUrl(order, { seq: 1, start: null, durationMin: 60 })).toBeNull();
  });
});
