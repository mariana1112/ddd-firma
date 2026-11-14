import { describe, expect, it } from 'vitest';
import { dateTile, dayHeading, groupByDay, orderTerm, sortOrderRows, type OrderListRow } from './order-list';
import type { Order, Visit } from './types';

const visit = (over: Partial<Visit>): Visit => ({ seq: 1, status: 'zaplanowany', start: null, doneOn: null, ...over }) as Visit;
const row = (number: number, ...visits: Visit[]): OrderListRow => ({ order: { id: String(number), number } as Order, visits });

describe('lista zleceń według daty', () => {
  const rows = [
    row(1, visit({ start: '2026-11-10T12:00' })),
    row(2, visit({ start: '2026-11-08T10:00' })),
    row(3, visit({ start: null })),
    row(4, visit({ start: '2026-11-10T09:00' })),
    row(5, visit({ status: 'wykonany', start: '2026-10-30T09:00', doneOn: '2026-10-31' })),
    row(6, visit({ status: 'wykonany', start: '2026-11-02T08:00', doneOn: '2026-11-02' }), visit({ seq: 2, start: '2026-11-16T08:00' })),
  ];

  it('termin: zabieg do zrobienia, a po wszystkich dzień wykonania', () => {
    expect(orderTerm(rows[0].visits)).toEqual({ date: '2026-11-10', time: '12:00' });
    expect(orderTerm(rows[2].visits)).toEqual({ date: null, time: null });
    expect(orderTerm(rows[4].visits)).toEqual({ date: '2026-10-31', time: null });
    expect(orderTerm(rows[5].visits)).toEqual({ date: '2026-11-16', time: '08:00' });
  });

  it('sortuje rosnąco i malejąco, bez terminu na końcu', () => {
    const numbers = (list: OrderListRow[]) => list.map((r) => r.order.number);
    expect(numbers(sortOrderRows(rows, 'najwczesniej'))).toEqual([5, 2, 4, 1, 6, 3]);
    expect(numbers(sortOrderRows(rows, 'najpozniej'))).toEqual([6, 1, 4, 2, 5, 3]);
    expect(numbers(sortOrderRows(rows, 'numer'))).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('od dziś: dziś i kolejne dni rosnąco, potem do umówienia, na końcu minione', () => {
    const numbers = (list: OrderListRow[]) => list.map((r) => r.order.number);
    expect(numbers(sortOrderRows(rows, 'od_dzis', '2026-11-10'))).toEqual([4, 1, 6, 3, 2, 5]);
  });

  it('grupuje po dniach i opisuje dzień', () => {
    const groups = groupByDay(sortOrderRows(rows, 'najwczesniej'));
    expect(groups.map((g) => [g.date, g.rows.length])).toEqual([
      ['2026-10-31', 1],
      ['2026-11-08', 1],
      ['2026-11-10', 2],
      ['2026-11-16', 1],
      [null, 1],
    ]);
    expect(dayHeading('2026-11-08', '2026-11-08')).toBe('Dziś · niedziela, 8 listopada');
    expect(dayHeading('2026-11-09', '2026-11-08')).toBe('Jutro · poniedziałek, 9 listopada');
    expect(dayHeading('2027-01-04', '2026-11-08')).toBe('poniedziałek, 4 stycznia 2027');
    expect(dayHeading(null, '2026-11-08')).toBe('Termin do umówienia');
    expect(dateTile('2026-11-08')).toEqual({ weekday: 'nd', day: '8', month: 'lis' });
  });
});

describe('kody zleceń i zabiegów', () => {
  it('prefiks regionu, cztery cyfry i numer zabiegu rzymski', async () => {
    const { normalizePrefix, orderCode, roman, visitCode } = await import('./codes');
    expect(orderCode({ number: 42, prefix: 'LDZ' })).toBe('LDZ-0042');
    expect(orderCode({ number: 42 })).toBe('0042');
    expect(orderCode({ number: 12345, prefix: 'WAW' })).toBe('WAW-12345');
    expect(visitCode({ number: 42, prefix: 'LDZ' }, 2)).toBe('LDZ-0042/II');
    expect([1, 2, 3, 4, 5, 9].map(roman)).toEqual(['I', 'II', 'III', 'IV', 'V', 'IX']);
    expect(normalizePrefix(' łdz-1 ')).toBe('ŁDZ');
    expect(normalizePrefix('abcdefg')).toBe('ABCDE');
  });

  it('wyszukiwanie po kodzie', async () => {
    const { matchesCode } = await import('./codes');
    const order = { number: 42, prefix: 'LDZ' };
    for (const q of ['42', '0042', '#42', '4', 'LDZ-0042', 'ldz42', 'LDZ-0042/II', 'ldz-0042/ii']) expect(matchesCode(order, q), q).toBe(true);
    for (const q of ['43', 'WAW-0042', '0043', 'LDZ-0042x']) expect(matchesCode(order, q), q).toBe(false);
  });
});

describe('kolejny zabieg', () => {
  it('rozróżnia umówiony, do umówienia, nieumówiony i brak', async () => {
    const { nextVisitState } = await import('./order-list');
    const v = (seq: number, status: Visit['status'], start: string | null) => visit({ seq, status, start });
    expect(nextVisitState([v(1, 'zaplanowany', '2026-11-10T15:30')])).toEqual({ kind: 'nieumowiony', seq: 2, afterSeq: 1 });
    expect(nextVisitState([v(1, 'zaplanowany', '2026-11-10T15:30'), v(2, 'zaplanowany', '2026-11-24T15:30')])).toEqual({ kind: 'umowiony', seq: 2, start: '2026-11-24T15:30' });
    expect(nextVisitState([v(1, 'wykonany', '2026-11-02T12:00'), v(2, 'zaplanowany', '2026-11-16T12:00')])).toEqual({ kind: 'umowiony', seq: 2, start: '2026-11-16T12:00' });
    expect(nextVisitState([v(1, 'wykonany', '2026-11-02T12:00'), v(2, 'zaplanowany', null)])).toEqual({ kind: 'do_umowienia', seq: 2 });
    expect(nextVisitState([v(1, 'wykonany', '2026-11-02T12:00'), v(2, 'w_trakcie', '2026-11-16T12:00')])).toEqual({ kind: 'nieumowiony', seq: 3, afterSeq: 2 });
    expect(nextVisitState([v(1, 'wykonany', '2026-11-02T12:00')])).toEqual({ kind: 'brak' });
    expect(nextVisitState([v(1, 'wykonany', '2026-11-02T12:00'), v(2, 'odwolany', '2026-11-16T12:00')])).toEqual({ kind: 'brak' });
  });
});

describe('zakres i cena zabiegu', () => {
  it('opis zakresu i propozycja z poprzedniego zabiegu', async () => {
    const { proposeTerms, scopeText, visitPrice } = await import('./visit-terms');
    expect(scopeText(undefined)).toBe('Całe mieszkanie');
    expect(scopeText({ kind: 'pokoj', note: 'sypialnia' })).toBe('Pokój: sypialnia');
    expect(scopeText({ kind: 'inne', note: '' })).toBe('Inne');
    const order = { priceMin: 30000, priceMax: 40000 };
    // Zabieg sprzed opcji: widełki zlecenia, całe mieszkanie.
    expect(proposeTerms([visit({ seq: 1 })], order)).toEqual({ scope: { kind: 'calosc', note: '' }, priceMin: 30000, priceMax: 40000 });
    const v2 = visit({ seq: 2, scope: { kind: 'pokoj', note: 'salon' }, priceMin: 25000, priceMax: 25000 });
    expect(proposeTerms([visit({ seq: 1 }), v2, visit({ seq: 3, status: 'odwolany' })], order)).toEqual({ scope: { kind: 'pokoj', note: 'salon' }, priceMin: 25000, priceMax: 25000 });
    expect(visitPrice({ priceMin: null, priceMax: null }, order)).toEqual({ priceMin: null, priceMax: null });
  });

  it('pola ustaleń: jedna kwota to cena stała, zła kwota blokuje zapis', async () => {
    const { termsFromDraft } = await import('../features/terms');
    expect(termsFromDraft({ kind: 'pokoj', note: ' sypialnia ', min: '300', max: '' })).toEqual({ scope: { kind: 'pokoj', note: 'sypialnia' }, priceMin: 30000, priceMax: 30000 });
    expect(termsFromDraft({ kind: 'calosc', note: 'x', min: '300', max: '400' })).toEqual({ scope: { kind: 'calosc', note: '' }, priceMin: 30000, priceMax: 40000 });
    expect(termsFromDraft({ kind: 'calosc', note: '', min: 'abc', max: '' })).toBeNull();
    expect(termsFromDraft({ kind: 'calosc', note: '', min: '500', max: '400' })).toBeNull();
  });
});

describe('szukanie zlecenia, gdy dzwoni klient', () => {
  it('numer w dowolnym zapisie, fragment numeru, nazwisko i kod', async () => {
    const { orderMatches, phoneDigits, looksLikePhone, mainPhone } = await import('./order-search');
    const o = {
      number: 42,
      prefix: 'LDZ',
      clientName: 'Jan Kowalski',
      street: 'Piotrkowska',
      houseNo: '12',
      flatNo: '3',
      building: 'blok',
      city: 'Łódź',
      postalCode: '90-001',
      pest: 'karaluchy',
      pestOther: '',
      phones: [{ number: '', label: '' }, { number: '500 600 700', label: 'żona' }],
    } as unknown as Order;
    expect(phoneDigits('+48 500-600-700')).toBe('500600700');
    expect(phoneDigits('0048500600700')).toBe('500600700');
    expect(looksLikePhone('kowalski')).toBe(false);
    expect(mainPhone(o)).toBe('500 600 700');
    for (const q of ['+48 500 600 700', '500600700', '600 700', '0048 500 600 700', 'kowalski', 'piotrkowska 12', 'LDZ-0042', '0042']) {
      expect(orderMatches(o, q), q).toBe(true);
    }
    for (const q of ['501 600 700', 'nowak', 'LDZ-0043']) expect(orderMatches(o, q), q).toBe(false);
  });
});
