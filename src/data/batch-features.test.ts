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
  it('wywiad: skala populacji; dawna „poprawa” już się nie pokazuje', () => {
    expect(interviewLines({ ...EMPTY_INTERVIEW, seenCount: 'ok. 20', improvement: 'tak', improvementNote: 'pojedyncze' })).toEqual(['Skala populacji: ok. 20']);
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

describe('zabieg II i kolejne: „Czy mieszkanie zostało uszczelnione?”', () => {
  it('wymagane, chyba że uszczelnienie potwierdzono przy wcześniejszym wykonanym zabiegu', async () => {
    const { requiredAnswersMissing, sealedBefore } = await import('./interview');
    const done = (seq: number, sealed: '' | 'tak' | 'nie') => visit({ id: `v${seq}`, seq, status: 'wykonany', interview: { ...EMPTY_INTERVIEW, improvement: 'tak', sealed } });
    const second = visit({ id: 'v2', seq: 2, status: 'w_trakcie', interview: { ...EMPTY_INTERVIEW, improvement: 'tak' } });
    expect(requiredAnswersMissing(visit({ seq: 1 }), [])).toEqual([]);
    expect(requiredAnswersMissing(second, [done(1, '')])).toEqual(['Czy mieszkanie zostało uszczelnione?']);
    // „Czy widać poprawę?” i ugryzienia usunięte: nie są wymagane ani nie trafiają do opisu.
    expect(requiredAnswersMissing(visit({ seq: 2, interview: EMPTY_INTERVIEW }), [])).toEqual(['Czy mieszkanie zostało uszczelnione?']);
    expect(interviewLines({ ...EMPTY_INTERVIEW, bites: 'tak', improvement: 'nie', improvementNote: 'dużo' })).toEqual([]);
    // Na II „nie” (z opisem): przy III nadal pytamy.
    const third = visit({ id: 'v3', seq: 3, status: 'w_trakcie', interview: { ...EMPTY_INTERVIEW, improvement: 'tak' } });
    expect(requiredAnswersMissing(third, [done(1, ''), done(2, 'nie')])).toEqual(['Czy mieszkanie zostało uszczelnione?']);
    // Na II „tak”: przy III już nie wymagamy.
    expect(sealedBefore(third, [done(1, ''), done(2, 'tak')])).toBe(2);
    expect(requiredAnswersMissing(third, [done(1, ''), done(2, 'tak')])).toEqual([]);
    expect(interviewLines({ ...EMPTY_INTERVIEW, sealed: 'nie', sealedNote: 'kratki w łazience' })).toEqual(['Mieszkanie uszczelnione: nie', 'Nie jest uszczelnione: kratki w łazience']);
  });
});

describe('paragon', () => {
  it('wymaga tylko e-maila; trafia do księgowej jak faktura; dane do paragonu bez nabywcy', async () => {
    const { accountingTasks, accountingNote } = await import('./accounting');
    const { documentTags } = await import('./methods');
    const { documentWord } = await import('./invoice');
    const p = order({ invoice: 'paragon', clientName: '', nip: '', email: '' });
    expect(invoiceMissing(p)).toEqual(['email']);
    expect(invoiceMissing({ ...p, email: 'jan@example.com' })).toEqual([]);
    expect(accountingTasks(p)).toEqual(['faktura']);
    expect(accountingNote({ ...p, protocol: false, invoiceDone: false, protocolDone: false, accountingClosedAt: null, archived: false }, [visit({ status: 'wykonany', invoicedAt: null })])).toBe('Czeka na księgową: paragon za zabieg I');
    expect(documentTags(p)).toEqual(['par']);
    expect(documentWord('paragon')).toMatchObject({ name: 'Paragon', of: 'paragonu' });
    const text = invoiceCopy({ ...p, email: 'jan@example.com' }, visit({ amount: 35000 }), 23, 'GDA-0014/I');
    expect(text).toContain('Paragon (na e-mail)');
    expect(text).toContain('E-mail: jan@example.com');
    expect(text).not.toContain('Nabywca');
  });
});

describe('kopiuj opis z dokumentami', () => {
  it('pod opisem zaznaczone dokumenty i dane: faktura VAT, imienna, paragon, protokół', () => {
    const v = visit();
    const first = descriptionCopy(v);
    expect(descriptionCopy(v, order({ invoice: 'brak', protocol: false }))).toBe(first);
    const vat = descriptionCopy(v, order({ invoice: 'vat', invoiceName: 'Apt sp. z o.o.', nip: '1234563218', invoiceAddress: 'Długa 1, Gdańsk', email: 'biuro@apt.pl', protocol: true, clientName: 'Jan Nowak' }));
    expect(vat.split('\n')).toEqual([first, 'Faktura VAT: Apt sp. z o.o., NIP 1234563218, Długa 1, Gdańsk, biuro@apt.pl', 'Protokół: Jan Nowak, biuro@apt.pl']);
    expect(descriptionCopy(v, order({ invoice: 'paragon', email: 'jan@example.com', protocol: false })).split('\n')[1]).toBe('Paragon na e-mail: jan@example.com');
    expect(descriptionCopy(v, order({ invoice: 'imienna', clientName: 'Jan Nowak', invoiceAddress: '', email: 'jan@example.com', protocol: false })).split('\n')[1]).toMatch(/^Faktura imienna: Jan Nowak, .+, jan@example\.com$/);
  });
});
