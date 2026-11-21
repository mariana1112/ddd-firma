import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { groupClients, clientKey } from './clients-view';
import { invoiceMissing } from './invoice';
import { dayPositions } from './order-list';
import { odometerAround } from './orders';
import { trips } from './repo';
import { saveProfile } from './settings';
import { descriptionCopy, invoiceCopy, interviewLines, orderAddress } from './texts';
import { EMPTY_INTERVIEW } from './interview';
import type { Order, Trip, Visit } from './types';

const order = (over: Partial<Order> = {}) =>
  ({
    id: 'o1', number: 14, prefix: 'GDA', street: 'Długa', houseNo: '5', flatNo: '', building: 'dom', city: 'Gdańsk', postalCode: '80-001',
    pest: 'pluskwy', pestOther: '', clientName: 'Jan Kowalski', email: 'jan@example.com', nip: '5260250274', invoiceName: '', invoiceAddress: '',
    invoice: 'vat', phones: [{ number: '+48 600 100 200', label: '' }], description: '', deletedAt: null, createdAt: '2026-11-20T08:00:00Z',
    ...over,
  }) as Order;

const visit = (over: Partial<Visit> = {}) =>
  ({
    id: 'v1', orderId: 'o1', seq: 1, status: 'wykonany', start: '2026-11-20T10:00', doneOn: '2026-11-20', amount: 36900, payMethod: 'gotowka',
    treatments: ['Oprysk ciśnieniowy'], places: [], recommendations: ['Wietrzyć'], interview: { ...EMPTY_INTERVIEW, situation: 'Pluskwy w sypialni' },
    deletedAt: null, ...over,
  }) as Visit;

describe('numer zabiegu w dniu', () => {
  it('kolejne zabiegi dnia dostają 1 z 3, 2 z 3…; odwołane się nie liczą', () => {
    const list = [visit({ id: 'b', start: '2026-11-20T11:00', status: 'zaplanowany' }), visit({ id: 'a', start: '2026-11-20T09:00', status: 'zaplanowany' }), visit({ id: 'x', start: '2026-11-20T10:00', status: 'odwolany' }), visit({ id: 'c', start: '2026-11-20T15:00', status: 'zaplanowany' })];
    const pos = dayPositions(list);
    expect(pos.get('a')).toEqual({ n: 1, of: 3 });
    expect(pos.get('b')).toEqual({ n: 2, of: 3 });
    expect(pos.get('c')).toEqual({ n: 3, of: 3 });
    expect(pos.get('x')).toBeUndefined();
  });
});

describe('kopiowanie', () => {
  it('opis: „Opis: kwota forma - opis”', () => {
    expect(descriptionCopy(visit())).toBe('Opis: 369 zł gotówka - Pluskwy w sypialni');
    expect(descriptionCopy(visit({ payMethod: 'blik' }))).toBe('Opis: 369 zł BLIK - Pluskwy w sypialni');
  });
  it('dane do faktury VAT: NIP, kwota brutto i netto; nazwa firmy nie jest wymagana', () => {
    const text = invoiceCopy(order(), visit(), 23, 'GDA-0014/I');
    expect(text).toContain('Faktura VAT');
    expect(text).toContain('NIP: 5260250274');
    expect(text).toContain('369 zł brutto (netto 300 zł, VAT 23%)');
    expect(text).toContain('Nabywca: Jan Kowalski');
    expect(invoiceMissing(order())).toEqual([]);
  });
  it('wywiad: skala populacji i poprawa przy kolejnym zabiegu', () => {
    expect(interviewLines({ ...EMPTY_INTERVIEW, seenCount: 'ok. 20', improvement: 'tak', improvementNote: 'pojedyncze' })).toEqual([
      'Skala populacji: ok. 20',
      'Widać poprawę: tak',
      'Co jest: pojedyncze',
    ]);
  });
});

describe('klient z jego zabiegami', () => {
  it('łączy zlecenia po telefonie; umówione i wykonane osobno', () => {
    const a = order({ id: 'o1' });
    const b = order({ id: 'o2', number: 20, phones: [{ number: '600 100 200', label: 'syn' }], street: 'Polna' });
    const other = order({ id: 'o3', phones: [{ number: '700 000 000', label: '' }] });
    const list = [visit({ id: 'v1', orderId: 'o1' }), visit({ id: 'v2', orderId: 'o2', status: 'zaplanowany', doneOn: null })];
    const groups = groupClients([a, b, other], list, orderAddress);
    const g = groups.find((x) => x.key === clientKey(a))!;
    expect(g.orders.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(g.done.map((v) => v.id)).toEqual(['v1']);
    expect(g.planned.map((v) => v.id)).toEqual(['v2']);
    expect(g.addresses).toHaveLength(2);
  });
});

describe('kilometrówka: przejazd z dawnego dnia', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await saveProfile({ name: 'Maurycy', userId: 'u1' });
  });
  it('licznik z tamtego dnia, a nie dzisiejszy; kolejny przejazd ogranicza licznik', async () => {
    const t = (date: string, a: number, b: number) => trips.create({ ownerId: 'u1', date, kind: 'sluzbowy', timeFrom: '08:00', timeTo: '', from: 'Gdańsk', via: '', to: 'Gdańsk', purpose: '', vehicle: '', driver: 'Maurycy', odometerStart: a, odometerEnd: b } as Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>);
    await t('2026-11-05', 5400, 5500);
    await t('2026-11-20', 6600, 6666);
    expect(await odometerAround('u1', '', '2026-11-11')).toEqual({ before: 5500, after: 6600 });
    expect(await odometerAround('u1', '', '2026-11-21')).toEqual({ before: 6666, after: null });
  });
});
