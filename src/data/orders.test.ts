import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { archiveOrder, cancelVisit, createOrder, finishVisit, orderVisits, restoreOrder, scheduleNextVisit, startVisit, type OrderDraft } from './orders';
import { buildReport, formatPln, periodOf, reportText, shiftPeriod } from './reports';
import { expenses, orders, trips, visits } from './repo';
import { DEFAULT_APP, getProfile, nextOrderNumber, ownedBy, saveProfile, saveRegion, setOrderCounter, setSyncState } from './settings';
import { centralExport, finishSms, interviewLines, mapsUrl, orderAddress, priceRange, reminderSms, smsUrl, workSummary } from './texts';
import { EMPTY_INTERVIEW, normalizeInterview } from './orders';
import type { Visit } from './types';

const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  building: 'blok',
  street: 'ul. Świętojańska',
  houseNo: '12',
  flatNo: '5',
  floor: '3',
  staircase: 'B',
  postalCode: '81-368',
  city: 'Gdynia',
  access: 'Domofon nie działa, dzwonić',
  pest: 'karaluchy',
  pestOther: '',
  description: 'Karaluchy w kuchni od miesiąca',
  areaM2: 48,
  priceMin: 30000,
  priceMax: 35000,
  invoice: 'brak',
  clientName: 'Jan Kowalski',
  email: '',
  nip: '',
  invoiceAddress: '',
  phones: [{ number: '600 700 800', label: '' }, { number: '601 000 000', label: 'tata' }],
  pink: false,
  pinkNote: '',
  ...over,
});

beforeEach(async () => {
  await db.delete();
  await db.open();
  await saveProfile({ name: 'Maurycy', userId: null });
});

describe('zlecenia', () => {
  it('numeruje kolejno i pozwala kontynuować dotychczasową numerację', async () => {
    await setOrderCounter(209);
    const { order } = await createOrder(draft(), { start: '2026-11-10T10:00', durationMin: 60 }, null);
    expect(order.number).toBe(210);
    expect(await nextOrderNumber()).toBe(211);
  });

  it('drugi zabieg powstaje od razu, gdy termin jest umówiony przy przyjęciu', async () => {
    const { order, visits: created } = await createOrder(
      draft(),
      { start: '2026-11-10T10:00', durationMin: 60 },
      { start: '2026-11-24T10:00', durationMin: 60 },
    );
    expect(created.map((v) => [v.seq, v.start, v.technicianName])).toEqual([
      [1, '2026-11-10T10:00', 'Maurycy'],
      [2, '2026-11-24T10:00', 'Maurycy'],
    ]);
    expect(order.ownerName).toBe('Maurycy');
  });

  it('zakończenie zabiegu zapisuje płatność, a technik umawiający trzeci zabieg dostaje premię', async () => {
    const { order, visits: [first] } = await createOrder(draft(), { start: '2026-11-10T10:00', durationMin: 60 }, null);
    await startVisit(first.id);
    const { next: second } = await finishVisit(first.id, {
      payMethod: 'gotowka',
      amount: 35000,
      treatments: ['Oprysk ciśnieniowy'],
      places: ['listwy'],
      findings: '',
      problems: '',
      recommendations: [],
      next: { mode: 'technik' },
    });
    expect(second?.seq).toBe(2);
    expect(second?.start).toBeNull();
    expect((await visits.get(first.id))?.bonus).toBe(0);

    const { next: third } = await finishVisit(second!.id, {
      payMethod: 'blik',
      amount: 20000,
      treatments: ['Żel'],
      places: [],
      findings: '',
      problems: '',
      recommendations: [],
      next: { mode: 'umowiony', start: '2026-12-01T09:00', durationMin: 60 },
    });
    expect(third?.seq).toBe(3);
    expect((await visits.get(second!.id))?.bonus).toBe(DEFAULT_APP.thirdVisitBonus);
    expect((await orderVisits(order.id)).map((v) => v.status)).toEqual(['wykonany', 'wykonany', 'zaplanowany']);
  });

  it('zlecenie bez kolejnego zabiegu zostaje zamknięte', async () => {
    const { order, visits: [first] } = await createOrder(draft(), { start: null, durationMin: 60 }, null);
    await finishVisit(first.id, {
      payMethod: 'przelew',
      amount: 30000,
      treatments: [],
      places: [],
      findings: '',
      problems: '',
      recommendations: [],
      next: { mode: 'brak' },
    });
    expect((await orders.get(order.id))?.closed).toBe(true);

    // Umówienie kolejnego zabiegu ze zlecenia: nowy zabieg II i zlecenie znów otwarte.
    const second = await scheduleNextVisit(order.id, { start: '2026-11-24T15:30', durationMin: 60, terms: { scope: { kind: 'pokoj', note: 'sypialnia' }, priceMin: 25000, priceMax: 25000 } });
    expect(second).toMatchObject({ seq: 2, start: '2026-11-24T15:30', status: 'zaplanowany', bonus: 0, scope: { kind: 'pokoj', note: 'sypialnia' }, priceMin: 25000 });
    expect((await orders.get(order.id))?.closed).toBe(false);
  });

  it('odwołanie zabiegu i zlecenia: archiwum, przywrócenie', async () => {
    const { isArchived } = await import('./order-list');
    const { order, visits: [first, second] } = await createOrder(draft(), { start: '2026-11-10T10:00', durationMin: 60 }, { start: '2026-11-24T10:00', durationMin: 60 });
    expect(await cancelVisit(second.id)).toEqual({ archived: false });
    expect(await cancelVisit(first.id)).toEqual({ archived: true });
    expect((await orders.get(order.id))?.archived).toBe(true);
    await restoreOrder(order.id);
    expect((await orders.get(order.id))?.archived).toBe(false);
    // Zlecenie z wykonanym zabiegiem: archiwum odwołuje tylko zabiegi do zrobienia.
    const other = await createOrder(draft(), { start: '2026-11-10T10:00', durationMin: 60 }, { start: '2026-11-24T10:00', durationMin: 60 });
    await visits.update(other.visits[0].id, { status: 'wykonany', doneOn: '2026-11-10' });
    await archiveOrder(other.order.id);
    const list = await orderVisits(other.order.id);
    expect(list.map((v) => v.status)).toEqual(['wykonany', 'odwolany']);
    expect(isArchived((await orders.get(other.order.id))!, list)).toBe(true);
  });

  it('wykonany zabieg bez płatności jest pilny', async () => {
    const { paymentMissing } = await import('./order-list');
    expect(paymentMissing({ status: 'wykonany', payMethod: null, amount: 30000 })).toBe(true);
    expect(paymentMissing({ status: 'wykonany', payMethod: 'blik', amount: null })).toBe(true);
    expect(paymentMissing({ status: 'wykonany', payMethod: 'blik', amount: 30000 })).toBe(false);
    expect(paymentMissing({ status: 'w_trakcie', payMethod: null, amount: null })).toBe(false);
  });

  it('umówienie ze zlecenia nadaje termin zabiegowi, który czeka bez terminu', async () => {
    const { order, visits: [first] } = await createOrder(draft(), { start: '2026-11-10T10:00', durationMin: 90 }, { start: null, durationMin: 90 });
    const second = await scheduleNextVisit(order.id, { start: '2026-11-24T09:00', durationMin: 90 });
    const list = await orderVisits(order.id);
    expect(list.map((v) => [v.seq, v.start])).toEqual([[1, '2026-11-10T10:00'], [2, '2026-11-24T09:00']]);
    expect(second.seq).toBe(2);
    expect(first.seq).toBe(1);
  });
});

describe('teksty', () => {
  it('przy fakturze VAT widełki mają też kwoty brutto', () => {
    expect(priceRange({ priceMin: 10000, priceMax: 15000, invoice: 'vat' }, 23)).toEqual({
      net: '100–150 zł netto',
      gross: '123–184,5 zł brutto',
    });
    expect(priceRange({ priceMin: 10000, priceMax: 15000, invoice: 'brak' }, 23)).toEqual({ net: '100–150 zł', gross: null });
    expect(priceRange({ priceMin: null, priceMax: null, invoice: 'vat' }, 23)).toBeNull();
  });

  it('adres bloku zawiera lokal, a link do map prowadzi trasę do adresu', () => {
    const o = draft();
    expect(orderAddress(o)).toBe('ul. Świętojańska 12/5, Gdynia');
    expect(mapsUrl(o)).toContain('destination=ul.%20%C5%9Awi%C4%99toja%C5%84ska%2012%2C%2081-368%20Gdynia');
    expect(smsUrl('600 700 800', 'Dzień dobry')).toBe('sms:600700800&body=Dzie%C5%84%20dobry');
  });

  it('podsumowanie pracy i SMS po zabiegu', () => {
    const visit = {
      seq: 1,
      treatments: ['Oprysk ciśnieniowy', 'Żel'],
      places: ['listwy', 'kratka', 'łóżka'],
      recommendations: ['Nie myć podłóg przez 14 dni.'],
    } as Visit;
    expect(workSummary(visit)).toBe('Oprysk ciśnieniowy (listwy, kratka, łóżka), Żel');
    const next = { seq: 2, start: '2026-11-24T10:00' } as Visit;
    const sms = finishSms(visit, next, DEFAULT_APP);
    expect(sms).toContain('Wykonano: Oprysk ciśnieniowy (listwy, kratka, łóżka), Żel.');
    expect(sms).toContain('- Nie myć podłóg przez 14 dni.');
    expect(sms).toContain('Drugi zabieg: 24.11.2026 o 10:00.');
    // Drugi zabieg bez umówionego trzeciego: wiadomość bez terminu.
    expect(finishSms({ ...visit, seq: 2 }, null, DEFAULT_APP)).not.toContain('zabieg:');
  });

  it('przypomnienie i eksport dla centrali zawierają kluczowe dane', async () => {
    await setOrderCounter(41);
    await saveRegion({ prefix: 'LDZ' });
    const { order, visits: [first] } = await createOrder(draft({ pink: true, pinkNote: 'agresywny pies' }), { start: '2026-11-10T10:00', durationMin: 60 }, null);
    expect(reminderSms(order, first, DEFAULT_APP)).toContain('10.11.2026 o 10:00, adres: ul. Świętojańska 12/5, Gdynia');
    const done: Visit = {
      ...first,
      status: 'wykonany',
      doneOn: '2026-11-10',
      payMethod: 'blik',
      amount: 35000,
      treatments: ['Oprysk ciśnieniowy'],
      places: ['listwy'],
      findings: 'Duża kolonia za lodówką',
      problems: 'Sąsiad też ma karaluchy',
      interview: { ...EMPTY_INTERVIEW, situation: 'Karaluchy w kuchni od miesiąca', seen: 'tak', seenCount: 'ok. 20', bites: 'nie' },
    };
    const text = centralExport(order, done, [done]);
    expect(order.prefix).toBe('LDZ');
    expect(text).toContain('Zlecenie LDZ-0042/I, zabieg I z 1');
    expect(text).toContain('blok, klatka B, piętro 3');
    expect(text).toContain('Co zastałem: Duża kolonia za lodówką');
    expect(text).toContain('Problemy: Sąsiad też ma karaluchy');
    expect(text).toContain('- Opis sytuacji: Karaluchy w kuchni od miesiąca');
    expect(text).toContain('- Ugryzienia: nie');
    expect(text).toContain('- Widziane owady: tak, ile: ok. 20');
    expect(text).not.toContain('Środki na własną rękę');
    expect(text).toContain('Płatność: 350 zł, BLIK, bez faktury');
    expect(text).toContain('KOD PINK: agresywny pies');
    // Bez wypełnionych dawnych pól „co zastałem” i „problemy” tych wierszy nie ma.
    const plain = centralExport(order, { ...done, findings: '', problems: '' }, [done]);
    expect(plain).not.toContain('Co zastałem');
    expect(plain).not.toContain('Problemy');
  });
});

describe('raporty', () => {
  it('okresy: tydzień od poniedziałku, miesiąc kalendarzowy', () => {
    expect(periodOf('tydzien', '2026-10-29')).toEqual({ kind: 'tydzien', from: '2026-10-26', to: '2026-11-01' });
    expect(periodOf('miesiac', '2026-02-10')).toEqual({ kind: 'miesiac', from: '2026-02-01', to: '2026-02-28' });
    expect(shiftPeriod(periodOf('tydzien', '2026-10-29'), -1).from).toBe('2026-10-19');
  });

  it('rozliczenie tygodnia w formacie dla szefa', async () => {
    const { order } = await createOrder(draft(), { start: null, durationMin: 60 }, null);
    const add = (doneOn: string, payMethod: Visit['payMethod'], amount: number, bonus = 0) =>
      visits.create({
        orderId: order.id,
        seq: 1,
        start: null,
        durationMin: 60,
        status: 'wykonany',
        technicianId: null,
        technicianName: 'Maurycy',
        startedAt: null,
        finishedAt: `${doneOn}T10:00:00.000Z`,
        doneOn,
        payMethod,
        amount,
        interview: EMPTY_INTERVIEW,
        treatments: [],
        places: [],
        findings: '',
        problems: '',
        recommendations: [],
        bonus,
        notes: '',
      });
    // Dane z przykładu: obrót 5 348 zł w tygodniu 26–29.10.2026.
    await add('2026-10-26', 'gotowka', 35000);
    await add('2026-10-26', 'blik', 85000);
    await add('2026-10-26', 'przelew', 73800);
    await add('2026-10-27', 'gotowka', 130000, 5000);
    await add('2026-10-28', 'gotowka', 40000);
    await add('2026-10-28', 'blik', 81000);
    await add('2026-10-28', 'przelew', 30000);
    await add('2026-10-29', 'gotowka', 25000);
    await add('2026-10-29', 'blik', 35000);
    await expenses.create({ date: '2026-10-27', category: 'Parking', amount: 1000, description: '', docNo: '', movementId: null });
    await trips.create({
      ownerId: null,
      date: '2026-10-27',
      kind: 'sluzbowy',
      timeFrom: '08:00',
      timeTo: '09:00',
      from: 'Gdańsk',
      to: 'Gdynia',
      purpose: '',
      odometerStart: 1000,
      odometerEnd: 1032,
    });

    const report = buildReport(periodOf('tydzien', '2026-10-28'), {
      visits: await visits.all(),
      orders: await orders.all(),
      expenses: await expenses.all(),
      trips: await trips.all(),
    });
    expect(report.turnover).toBe(534800);
    expect(report.cashForBoss).toBe(224000);
    expect(report.km).toEqual({ sluzbowy: 32, prywatny: 0 });

    const text = reportText(report, { technician: 'Maurycy', bossGenitive: 'Piotrka' });
    expect(text.split('\n')).toEqual([
      'Obrót tygodnia 26.10.26r. - 29.10.26r. - 5 348 zł',
      'Gotówka - 2 300 zł',
      'Blik - 2 010 zł',
      'Przelew - 1 038 zł',
      '',
      'Koszty 60 zł w tym:',
      'Premia: 50 zł',
      'Parking: 10 zł',
      '',
      'Wynik gotówka dla Piotrka - 2 240 zł',
      '',
      'Dane szczegółowe gotówka 2 300 zł w tym:',
      'Pn - 350 zł',
      'Wt - 1 300 zł',
      'Śr - 400 zł',
      'Cz - 250 zł',
      '',
      'Dane szczegółowe blik 2 010 zł w tym:',
      'Pn - 850 zł',
      'Śr - 810 zł',
      'Cz - 350 zł',
      '',
      'Dane szczegółowe przelew 1 038 zł w tym:',
      'Pn - 738 zł',
      'Śr - 300 zł',
    ]);
  });

  // Zabieg wykonany i zapłacony, do raportów dziennych i miesięcznych.
  const paid = async (doneOn: string, time: string, payMethod: Visit['payMethod'], amount: number, address: Partial<OrderDraft>, bonus = 0) => {
    const { order } = await createOrder(draft({ building: 'dom', flatNo: '', ...address }), { start: null, durationMin: 60 }, null);
    return visits.create({
      orderId: order.id, seq: 2, start: null, durationMin: 60, status: 'wykonany', technicianId: null, technicianName: 'Maurycy',
      startedAt: null, finishedAt: `${doneOn}T${time}:00.000Z`, doneOn, payMethod, amount, interview: EMPTY_INTERVIEW,
      treatments: [], places: [], findings: '', problems: '', recommendations: [], bonus, notes: '',
    });
  };
  const all = async () => ({ visits: await visits.all(), orders: await orders.all(), expenses: await expenses.all(), trips: await trips.all() });
  const names = { technician: 'Maurycy', bossGenitive: 'Piotrka' };

  it('rozliczenie dnia z adresami według formy płatności', async () => {
    // Dzień z przykładu: 14.10.26, obrót 2 250 zł, paliwo 51 zł z gotówki.
    await paid('2026-10-14', '08:00', 'gotowka', 70000, { street: 'Janusza Korczaka', houseNo: '11', postalCode: '82-500', city: 'Kwidzyn' });
    await paid('2026-10-14', '10:00', 'blik', 40000, { street: 'Konrada Guderskiego', houseNo: '55', postalCode: '80-180', city: 'Gdańsk' });
    await paid('2026-10-14', '11:00', 'gotowka', 40000, { street: 'aleja Rzeczypospolitej', houseNo: '4C', postalCode: '80-369', city: 'Gdańsk' });
    await paid('2026-10-14', '13:00', 'blik', 40000, { street: 'Lubomira Szopińskiego', houseNo: '3A', postalCode: '80-766', city: 'Gdańsk' });
    await paid('2026-10-14', '15:00', 'przelew', 35000, { street: 'Aleja Generała Józefa Hallera', houseNo: '115', postalCode: '80-416', city: 'Gdańsk' });
    await expenses.create({ date: '2026-10-14', category: 'Paliwo', amount: 5100, description: 'faktura', docNo: '', movementId: null });

    const report = buildReport(periodOf('dzien', '2026-10-14'), await all());
    expect(reportText(report, names).split('\n')).toEqual([
      'Obrót dnia 14.10.26r. - 2 250 zł',
      'Gotówka - 1 100 zł (-51 zł paliwo, czyli gotówki wychodzi 1 049 zł)',
      'Blik - 800 zł',
      'Przelew - 350 zł',
      '',
      'Koszty 51 zł w tym:',
      'Paliwo: 51 zł',
      '',
      'Wynik gotówka dla Piotrka - 1 049 zł',
      '',
      'Dane szczegółowe gotówka 1 100 zł w tym:',
      '1. 700 zł, Janusza Korczaka 11, 82-500 Kwidzyn',
      '2. 400 zł, aleja Rzeczypospolitej 4C, 80-369 Gdańsk',
      '',
      'Dane szczegółowe blik 800 zł w tym:',
      '1. 400 zł, Konrada Guderskiego 55, 80-180 Gdańsk',
      '2. 400 zł, Lubomira Szopińskiego 3A, 80-766 Gdańsk',
      '',
      'Dane szczegółowe przelew 350 zł w tym:',
      '1. 350 zł, Aleja Generała Józefa Hallera 115, 80-416 Gdańsk',
    ]);
  });

  it('dzień bez bliku i z fakturą VAT: „Brak” i kwota brutto', async () => {
    await paid('2026-10-12', '09:00', 'gotowka', 40000, { street: 'Morska', houseNo: '176', postalCode: '81-222', city: 'Gdynia' });
    await paid('2026-10-12', '12:00', 'przelew', 55350, { street: 'Morenowe Wzgórze', houseNo: '18', postalCode: '80-283', city: 'Gdańsk', invoice: 'vat' });
    const lines = reportText(buildReport(periodOf('dzien', '2026-10-12'), await all()), names).split('\n');
    expect(lines.slice(0, 4)).toEqual(['Obrót dnia 12.10.26r. - 953,5 zł', 'Gotówka - 400 zł', 'Blik - 0 zł', 'Przelew - 553,5 zł']);
    expect(lines[lines.indexOf('Dane szczegółowe blik 0 zł w tym:') + 1]).toBe('Brak');
    expect(lines.at(-1)).toBe('1. 553,5 zł brutto, Morenowe Wzgórze 18, 80-283 Gdańsk');
  });

  it('rozliczenie miesiąca według tygodni, koszty i premie odjęte od gotówki', async () => {
    const at = { street: 'Morska', houseNo: '1', postalCode: '81-222', city: 'Gdynia' };
    await paid('2026-10-01', '09:00', 'gotowka', 40000, at);
    await paid('2026-10-02', '09:00', 'przelew', 49200, at);
    await paid('2026-10-06', '09:00', 'gotowka', 380000, at, 10000);
    await paid('2026-10-07', '09:00', 'blik', 150000, at);
    await paid('2026-10-14', '09:00', 'gotowka', 310000, at, 10000);
    await paid('2026-10-27', '09:00', 'blik', 201000, at);
    await paid('2026-10-29', '09:00', 'gotowka', 365000, at);
    await expenses.create({ date: '2026-10-05', category: 'Zaliczka', amount: 120000, description: '', docNo: '', movementId: null });
    await expenses.create({ date: '2026-10-14', category: 'Paliwo', amount: 5100, description: '', docNo: '', movementId: null });
    // Dawny koszt kategorii „Inne” ma nazwę w opisie; ta sama nazwa inną wielkością liter to jeden wiersz.
    await expenses.create({ date: '2026-10-20', category: 'Inne', amount: 5000, description: 'Utrzymanie auta', docNo: '', movementId: null });
    await expenses.create({ date: '2026-10-21', category: 'utrzymanie auta', amount: 5050, description: '', docNo: '', movementId: null });

    const report = buildReport(periodOf('miesiac', '2026-10-15'), await all());
    expect(report.cashForBoss).toBe(40000 + 380000 + 310000 + 365000 - 120000 - 5100 - 10050 - 20000);
    expect(reportText(report, names).split('\n')).toEqual([
      'Obrót miesiąca Październik 2026 - 14 952 zł',
      'Gotówka - 10 950 zł',
      'Blik - 3 510 zł',
      'Przelew - 492 zł',
      '',
      'Koszty 1 551,5 zł w tym:',
      'Premia: 200 zł',
      'Zaliczka: 1 200 zł',
      'Paliwo: 51 zł',
      'Utrzymanie auta: 100,5 zł',
      '',
      'Wynik gotówka dla Piotrka - 9 398,5 zł',
      '',
      'Dane szczegółowe gotówka 10 950 zł w tym:',
      'Tydzień 1 (01.10.26r. - 02.10.26r.) - 400 zł',
      'Tydzień 2 (05.10.26r. - 07.10.26r.) - 3 800 zł',
      'Tydzień 3 (14.10.26r. - 14.10.26r.) - 3 100 zł',
      'Tydzień 4 (20.10.26r. - 21.10.26r.) - 0 zł',
      'Tydzień 5 (27.10.26r. - 29.10.26r.) - 3 650 zł',
      '',
      'Dane szczegółowe blik 3 510 zł w tym:',
      'Tydzień 1 (01.10.26r. - 02.10.26r.) - 0 zł',
      'Tydzień 2 (05.10.26r. - 07.10.26r.) - 1 500 zł',
      'Tydzień 3 (14.10.26r. - 14.10.26r.) - 0 zł',
      'Tydzień 4 (20.10.26r. - 21.10.26r.) - 0 zł',
      'Tydzień 5 (27.10.26r. - 29.10.26r.) - 2 010 zł',
      '',
      'Dane szczegółowe przelew 492 zł w tym:',
      'Tydzień 1 (01.10.26r. - 02.10.26r.) - 492 zł',
      'Tydzień 2 (05.10.26r. - 07.10.26r.) - 0 zł',
      'Tydzień 3 (14.10.26r. - 14.10.26r.) - 0 zł',
      'Tydzień 4 (20.10.26r. - 21.10.26r.) - 0 zł',
      'Tydzień 5 (27.10.26r. - 29.10.26r.) - 0 zł',
    ]);
  });

  it('kwoty z groszami mają dwie cyfry po przecinku', () => {
    expect(formatPln(18450)).toBe('184,50 zł');
    expect(formatPln(534800)).toBe('5 348 zł');
  });
});

describe('propozycje terminów', () => {
  it('proponuje dzień z zabiegiem w pobliżu, po nim i z doliczonym dojazdem', async () => {
    const { haversineKm, suggestSlots, travelMinutes } = await import('./geo');
    const gdynia = { lat: 54.5189, lng: 18.5305 };
    const rumia = { lat: 54.5708, lng: 18.3878 };
    const krakow = { lat: 50.0647, lng: 19.945 };
    expect(Math.round(haversineKm(gdynia, rumia))).toBe(11);

    const { order, visits: [near] } = await createOrder(draft(), { start: '2026-11-16T10:00', durationMin: 60 }, null);
    const { visits: [far] } = await createOrder(draft({ city: 'Kraków' }), { start: '2026-11-12T10:00', durationMin: 60 }, null);
    const [first, ...rest] = suggestSlots(rumia, 60, '2026-11-12', [
      { order, visit: near, point: gdynia },
      { order, visit: far, point: krakow },
    ]);
    expect(rest).toEqual([]);
    expect(first.date).toBe('2026-11-16');
    expect(first.travelMin).toBe(travelMinutes(first.distanceKm));
    // 10:00 + 60 min zabiegu + dojazd, zaokrąglone w górę do kwadransa.
    expect(first.start).toBe('2026-11-16T11:30');
  });
});

describe('właściciel rekordów', () => {
  it('profil urządzenia zalogowanego przed jego dodaniem bierze imię i identyfikator z konta', async () => {
    await db.meta.delete('profile');
    await setSyncState({ orgId: 'o', orgName: 'Firma', userId: 'u1', email: 'a@b.pl', cursor: 0, lastSyncAt: null, lastError: null, displayName: 'Maurycy' });
    expect(await getProfile()).toEqual({ name: 'Maurycy', userId: 'u1' });
  });

  it('rekord bez właściciela należy do użytkownika tego urządzenia, ale nie do innych techników', () => {
    expect(ownedBy(null, 'u1', true)).toBe(true);
    expect(ownedBy(null, 'u2', false)).toBe(false);
    expect(ownedBy('u1', 'u1', false)).toBe(true);
    expect(ownedBy('u2', 'u1', true)).toBe(false);
    expect(ownedBy('u2', null, true)).toBe(true);
  });
});

describe('wywiad', () => {
  it('dawny wywiad tekstowy przechodzi do opisu sytuacji i odpowiedzi tak/nie', () => {
    const old = { since: 'od miesiąca', what: 'Karaluchy nocą', where: 'kuchnia', bites: 'Tak, na nogach', seen: 'kilka w kuchni', selfTreatment: 'nie', other: 'pies' };
    expect(normalizeInterview(old)).toEqual({
      situation: ['Karaluchy nocą', 'Gdzie: kuchnia', 'Od kiedy: od miesiąca', 'Ugryzienia: na nogach'].join('\n'),
      bites: 'tak',
      seen: 'tak',
      seenCount: 'kilka w kuchni',
      selfTreatment: 'nie',
      other: 'pies',
    });
    expect(normalizeInterview(undefined)).toEqual(EMPTY_INTERVIEW);
  });

  it('obecny wywiad zostaje bez zmian', () => {
    const now = { situation: 'Pluskwy w sypialni', bites: 'tak', seen: 'nie', seenCount: '', selfTreatment: 'tak', other: '' } as const;
    expect(normalizeInterview(now)).toEqual(now);
    expect(interviewLines(now)).toEqual(['Opis sytuacji: Pluskwy w sypialni', 'Ugryzienia: tak', 'Widziane owady: nie', 'Środki na własną rękę: tak']);
  });
});
