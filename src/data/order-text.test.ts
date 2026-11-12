import { describe, expect, it } from 'vitest';
import { orderText } from './texts';
import type { Order, Visit } from './types';

describe('opis zlecenia do skopiowania', () => {
  it('klient, telefon, adres z klatką i piętrem, co robimy, opis i zabiegi; puste pola pominięte', () => {
    const order = {
      number: 4,
      prefix: '',
      clientName: 'Anna Nowak',
      phones: [{ number: '+48 501 502 503', label: '' }],
      street: 'Długa',
      houseNo: '5',
      flatNo: '3',
      staircase: '2',
      floor: '4',
      building: 'blok',
      city: 'Gdańsk',
      postalCode: '80-001',
      access: 'Domofon 3',
      pest: 'pluskwy',
      pestOther: '',
      methods: ['oprysk', 'zamglawianie'],
      description: 'Ugryzienia w sypialni od tygodnia',
      areaM2: 48,
      priceMin: 30000,
      priceMax: 40000,
      invoice: 'brak',
      protocol: false,
      email: '',
      pink: false,
      pinkNote: '',
    } as unknown as Order;
    const visits = [
      { seq: 2, status: 'zaplanowany', start: null, doneOn: null, deletedAt: null },
      { seq: 1, status: 'wykonany', start: '2026-11-10T10:00', doneOn: '2026-11-10', deletedAt: null },
    ] as unknown as Visit[];
    const text = orderText(order, visits, 23);
    expect(text).toContain('Zlecenie 0004 · Anna Nowak');
    expect(text).toContain('Tel.: +48 501 502 503');
    expect(text).toContain('Adres: Długa 5/3, Gdańsk (80-001), blok, klatka 2, piętro 4');
    expect(text).toContain('Jak dotrzeć: Domofon 3');
    expect(text).toContain('Co robimy: Oprysk ciśnieniowy, Zamgławianie ULV');
    expect(text).toContain('Opis: Ugryzienia w sypialni od tygodnia');
    expect(text).toContain('- 0004/I: 10.11.2026 (wykonany)');
    expect(text).toContain('- 0004/II: do umówienia');
    expect(text).not.toContain('Faktura');
    expect(text).not.toContain('E-mail');
  });
});
