import { describe, expect, it } from 'vitest';
import { normalizeCity } from './cities';
import { doneMethods, documentTags, METHOD_RECOMMENDATIONS, methodNames, methodOf, methodPackage, orderMethods, recommendationsFor } from './methods';
import { urgentReason } from './order-list';
import { orderMatches } from './order-search';
import type { Order, Visit } from './types';

const order = {
  number: 7,
  prefix: 'GDA',
  clientName: 'Anna Nowak',
  street: 'Długa',
  houseNo: '5',
  flatNo: '',
  building: 'dom',
  city: 'Gdańsk',
  postalCode: '80-001',
  pest: 'karaluchy',
  pestOther: '',
  phones: [{ number: '500 600 700', label: '' }],
  invoice: 'vat',
  protocol: true,
  methods: ['ulv', 'zelowanie'],
} as unknown as Order;

describe('metody zabiegu i zalecenia', () => {
  it('nazwy zabiegów (także dawne) wskazują metodę; bez zaznaczonych zostają metody zlecenia', () => {
    expect(methodOf('Żel')).toBe('zelowanie');
    // Dawne „Zamgławianie” to dziś „Zamgławianie ULV”; parowanie jest osobną metodą.
    expect(methodOf('Zamgławianie')).toBe('ulv');
    expect(methodOf('Parowanie gorącą parą')).toBe('parowanie');
    expect(orderMethods({ methods: ['zamglawianie', 'ulv', 'oprysk'] })).toEqual(['ulv', 'oprysk']);
    expect(methodOf('Zamgławianie ULV')).toBe('ulv');
    expect(methodOf('ULV')).toBe('ulv');
    expect(methodOf('Oprysk ciśnieniowy')).toBe('oprysk');
    expect(methodOf('Pułapki lepowe')).toBeNull();
    expect(doneMethods(['Zalanie odpływów', 'Pułapki lepowe'], order)).toEqual(['odplywy']);
    expect(doneMethods(['Pułapki lepowe'], order)).toEqual(['ulv', 'zelowanie']);
  });

  it('ULV: zalecenia o opuszczeniu lokalu i sprzątaniu są obowiązkowe; inne metody mają swoje', () => {
    const ulv = recommendationsFor(['ulv'], 'karaluchy');
    expect(ulv.required).toEqual(METHOD_RECOMMENDATIONS.ulv);
    expect(ulv.list.some((r) => r.startsWith('Opuszczenie lokalu'))).toBe(true);
    expect(ulv.list.some((r) => r.startsWith('Sprzątanie'))).toBe(true);
    const fog = recommendationsFor(['zamglawianie'], 'karaluchy');
    expect(fog.required).toEqual(ulv.required);
    expect(fog.list.some((r) => r.startsWith('Opuszczenie lokalu'))).toBe(true);
    const gel = recommendationsFor(['zelowanie'], 'pluskwy');
    expect(gel.required).toEqual([]);
    expect(gel.list).toContain('Nie odkurzać ani nie myć miejsc, w których jest żel.');
    expect(gel.list.some((r) => r.startsWith('Pranie'))).toBe(true);
    expect(gel.list.some((r) => r.startsWith('Opuszczenie lokalu'))).toBe(false);
  });

  it('oznaczenia dokumentów i szukanie po nich: fv23, fv, prot', () => {
    expect(documentTags(order)).toEqual(['fv23', 'prot']);
    expect(documentTags({ invoice: 'imienna', protocol: false })).toEqual(['fv']);
    expect(orderMatches(order, 'fv23')).toBe(true);
    expect(orderMatches(order, 'prot')).toBe(true);
    expect(orderMatches(order, 'fv')).toBe(false);
    expect(orderMatches(order, 'prot nowak')).toBe(true);
    expect(orderMatches(order, 'prot kowalski')).toBe(false);
  });
});

describe('poprawianie nazw miejscowości', () => {
  it('znane miejscowości z polskimi znakami, inne z wielkich liter', () => {
    expect(normalizeCity('gdansk')).toBe('Gdańsk');
    expect(normalizeCity('  GDAŃSK ')).toBe('Gdańsk');
    expect(normalizeCity('lodz')).toBe('Łódź');
    expect(normalizeCity('pruszcz gdanski')).toBe('Pruszcz Gdański');
    expect(normalizeCity('bielsko-biala')).toBe('Bielsko-Biała');
    expect(normalizeCity('nowa wieś lęborska')).toBe('Nowa Wieś Lęborska');
    expect(normalizeCity('')).toBe('');
  });
});

describe('pilne zlecenia', () => {
  const visit = (patch: Partial<Visit>) => ({ status: 'zaplanowany', start: '2026-11-12T10:00', payMethod: null, amount: null, ...patch }) as Visit;
  it('niedokończony zabieg, brak płatności, zaległy termin; archiwum nie jest pilne', () => {
    const today = '2026-11-10';
    expect(urgentReason({}, [visit({ status: 'w_trakcie' })], today)).toBe('w_trakcie');
    expect(urgentReason({}, [visit({ status: 'wykonany' })], today)).toBe('platnosc');
    expect(urgentReason({}, [visit({ start: '2026-11-09T10:00' })], today)).toBe('zalegly');
    expect(urgentReason({}, [visit({})], today)).toBeNull();
    expect(urgentReason({ archived: true }, [visit({ status: 'w_trakcie' })], today)).toBeNull();
  });
});

describe('lista: każdy zabieg osobno', () => {
  const v = (patch: Partial<Visit>) => ({ status: 'zaplanowany', start: '2026-11-12T10:00', payMethod: null, amount: null, ...patch }) as Visit;
  it('odwołany zabieg tylko w archiwum; wykonany w zakończonych; płatność bez innych zabiegów', async () => {
    const { visitInFilter, currentVisit } = await import('./order-list');
    const today = '2026-11-10';
    const cancelled = v({ status: 'odwolany' });
    expect(visitInFilter({}, cancelled, 'wszystkie', today)).toBe(false);
    expect(visitInFilter({}, cancelled, 'archiwum', today)).toBe(true);
    const done = v({ status: 'wykonany', payMethod: 'blik', amount: 45000 });
    expect(visitInFilter({}, done, 'wykonane', today)).toBe(true);
    expect(visitInFilter({}, done, 'aktywne', today)).toBe(false);
    expect(visitInFilter({}, v({ status: 'wykonany' }), 'pilne', today)).toBe(true);
    expect(visitInFilter({ archived: true }, done, 'wykonane', today)).toBe(false);
    // Połączony widok: odwołany zabieg II nie zasłania wykonanego zabiegu I.
    expect(currentVisit([{ ...done, seq: 1 } as Visit, { ...cancelled, seq: 2 } as Visit])?.status).toBe('wykonany');
  });
});

describe('pakiety zaleceń i inna metoda', () => {
  it('pakiet ustawiony przez technika zastępuje domyślny, „Inna metoda” nie ma pakietu', () => {
    expect(methodPackage('oprysk')).toEqual(METHOD_RECOMMENDATIONS.oprysk);
    expect(methodPackage('oprysk', { oprysk: ['Tylko to'] })).toEqual(['Tylko to']);
    expect(methodPackage('zamglawianie', { ulv: ['Wyjść na 4 godz.'] })).toEqual(['Wyjść na 4 godz.']);
    expect(methodPackage('inne', { inne: ['x'] })).toEqual([]);
    expect(recommendationsFor(['oprysk', 'inne'], 'karaluchy', { oprysk: ['A'] }).list).toEqual(['A']);
  });

  it('nazwa innej metody zamiast „Inna metoda”', () => {
    expect(methodNames({ methods: ['oprysk', 'inne'], methodOther: 'Dezynfekcja' })).toEqual(['Oprysk ciśnieniowy', 'Dezynfekcja']);
    expect(methodNames({ methods: ['inne'], methodOther: ' ' })).toEqual(['Inna metoda']);
  });
});
