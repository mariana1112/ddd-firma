import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { EMPTY_INTERVIEW } from '../data/orders';
import { buildReport, periodOf } from '../data/reports';
import type { Expense, Order, Trip, Visit } from '../data/types';
import { driverSummary, mileageSheets } from '../data/mileage';
import { mileageDocument, reportDocument } from './documents';

const require = createRequire(import.meta.url);
const stamps = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', deletedAt: null };

async function render(definition: TDocumentDefinitions, name: string): Promise<Buffer> {
  const pdfmake = require('pdfmake');
  const dir = require.resolve('pdfmake/package.json').replace('package.json', 'fonts/Roboto/');
  pdfmake.setFonts({
    Roboto: {
      normal: `${dir}Roboto-Regular.ttf`,
      bold: `${dir}Roboto-Medium.ttf`,
      italics: `${dir}Roboto-Italic.ttf`,
      bolditalics: `${dir}Roboto-MediumItalic.ttf`,
    },
  });
  const buffer: Buffer = await pdfmake.createPdf(definition).getBuffer();
  // PDF_OUT pozwala obejrzeć wygenerowane pliki, gdy zmienia się układ dokumentów.
  if (process.env.PDF_OUT) {
    mkdirSync(process.env.PDF_OUT, { recursive: true });
    writeFileSync(join(process.env.PDF_OUT, name), buffer);
  }
  return buffer;
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-' && b.length > 1000;

const order: Order = {
  ...stamps,
  id: 'o1',
  number: 210,
  ownerId: null,
  ownerName: 'Maurycy',
  building: 'blok',
  street: 'ul. Świętojańska',
  houseNo: '12',
  flatNo: '5',
  floor: '3',
  staircase: 'B',
  postalCode: '81-368',
  city: 'Gdynia',
  access: '',
  pest: 'pluskwy',
  pestOther: '',
  description: '',
  areaM2: 48,
  priceMin: 30000,
  priceMax: 35000,
  invoice: 'vat',
  clientName: 'Gęś i Żuraw Sp. z o.o.',
  email: '',
  nip: '5260001246',
  invoiceAddress: '',
  phones: [{ number: '600700800', label: '' }],
  pink: false,
  pinkNote: '',
  closed: false,
};

const visit = (doneOn: string, payMethod: Visit['payMethod'], amount: number): Visit => ({
  ...stamps,
  id: `v-${doneOn}-${payMethod}`,
  orderId: 'o1',
  seq: 1,
  start: `${doneOn}T10:00`,
  durationMin: 60,
  status: 'wykonany',
  technicianId: null,
  technicianName: 'Maurycy',
  startedAt: null,
  finishedAt: `${doneOn}T11:00:00.000Z`,
  doneOn,
  payMethod,
  amount,
  interview: EMPTY_INTERVIEW,
  treatments: [],
  places: [],
  findings: '',
  problems: '',
  recommendations: [],
  bonus: 0,
  notes: '',
});

const expense: Expense = { ...stamps, id: 'e1', date: '2026-10-27', category: 'Autostrada', amount: 1000, description: 'A1 Gdańsk–Toruń', docNo: '', movementId: null };

const trip = (date: string, kind: Trip['kind'], start: number, end: number): Trip => ({
  ...stamps,
  id: `t-${date}-${start}`,
  ownerId: null,
  date,
  kind,
  timeFrom: '08:00',
  timeTo: '08:40',
  from: 'Gdańsk Wrzeszcz',
  to: 'Gdynia Śródmieście',
  purpose: 'Zlecenie #210, pluskwy',
  odometerStart: start,
  odometerEnd: end,
});

describe('dokumenty PDF', () => {
  it('raport tygodniowy z polskimi znakami', async () => {
    const report = buildReport(periodOf('tydzien', '2026-10-28'), {
      visits: [visit('2026-10-26', 'gotowka', 35000), visit('2026-10-28', 'blik', 81000), visit('2026-10-29', 'przelew', 30000)],
      orders: [order],
      expenses: [expense],
      trips: [trip('2026-10-27', 'sluzbowy', 1000, 1032)],
    });
    expect(isPdf(await render(reportDocument(report, { technician: 'Maurycy', bossGenitive: 'Piotrka' }), 'raport.pdf'))).toBe(true);
  });

  it('pusty raport', async () => {
    const report = buildReport(periodOf('dzien', '2026-11-04'), { visits: [], orders: [], expenses: [], trips: [] });
    expect(isPdf(await render(reportDocument(report, { technician: 'Maurycy', bossGenitive: 'Piotrka' }), 'raport-pusty.pdf'))).toBe(true);
  });

  it('kilometrówka według wzoru ewidencji VAT', async () => {
    // Październik z wypełnionego ręcznie wzoru: 25 dni, dwie strony.
    const days: Array<[string, string, number, number]> = [
      ['01', '', 34945, 35029], ['02', 'Kutno', 35029, 35234], ['03', 'Zgierz', 35234, 35326], ['05', 'Konin, Koło', 35326, 35806],
      ['06', '', 35806, 35938], ['07', '', 35938, 35984], ['08', 'Skępe', 35984, 36336], ['09', '', 36336, 36417],
      ['10', '', 36417, 36492], ['12', 'Konin, Kępno', 36492, 37007], ['13', 'Kalisz', 37007, 37257], ['14', 'Pabianice', 37257, 37300],
      ['15', '', 37300, 37354], ['16', '', 37354, 37559], ['19', 'Sieradz', 37559, 37787], ['20', 'Kraśnica', 37787, 37926],
      ['21', 'Żyrardów', 37926, 38162], ['22', 'Kalisz', 38162, 38474], ['23', 'Kalisz', 38474, 38905], ['26', 'Lubstów', 38905, 39156],
      ['27', 'Sieradz, Kalisz', 39156, 39639], ['28', 'Kraśnica', 39639, 39695], ['29', 'Konin, Pabianice', 39695, 39993],
      ['30', 'Żyrardów', 39993, 40228], ['31', 'Konin', 40228, 40493],
    ];
    const list: Trip[] = days.map(([d, via, a, b]) => ({
      ...trip(`2026-10-${d}`, 'sluzbowy', a, b),
      from: 'Łódź',
      to: 'Łódź',
      via,
      vehicle: 'WE 1KR10',
      driver: 'Teodorczyk',
    }));
    // Prywatny wypad między służbowymi i drugi kierowca na innym aucie.
    list.push({ ...trip('2026-10-11', 'prywatny', 36492, 36492), from: 'Łódź', to: 'Łódź', vehicle: 'we1kr10', driver: 'Teodorczyk' });
    list.push({ ...trip('2026-10-11', 'prywatny', 1000, 1040), ownerId: 'u2', from: 'Gdańsk', to: 'Sopot', vehicle: 'GD 12345', driver: 'Jan Nowak' });
    const name = (t: Trip) => t.driver ?? '';

    const sheets = mileageSheets(list, 'sluzbowy', '2026-10', name);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].vehicle).toBe('WE1KR10');
    const entries = sheets[0].entries;
    expect(entries).toHaveLength(25);
    expect(entries[0].route).toBe('Łódź');
    expect(entries[3].route).toBe('Łódź - Konin - Koło - Łódź');
    expect(entries.slice(0, 17).reduce((s, e) => s + e.km, 0)).toBe(3217);
    expect(entries.slice(17).reduce((s, e) => s + e.km, 0)).toBe(2331);

    const taxpayer = 'P.H.U. TEST Jan Kowalski, ul. Piotrkowska 1, 90-001 Łódź, NIP 7251234567';
    const vat = mileageDocument({ kind: 'sluzbowy', month: '2026-10', taxpayer, sheets });
    // Kolumna kierowcy w ewidencji VAT zostaje pusta do własnoręcznego wpisu.
    expect(JSON.stringify(vat.content)).not.toContain('Teodorczyk');
    expect(JSON.stringify(vat.content)).toContain('P.H.U. TEST Jan Kowalski');
    expect(isPdf(await render(vat, 'kilometrowka-vat.pdf'))).toBe(true);
    const privateSheets = mileageSheets(list, 'prywatny', '2026-10', name);
    expect(privateSheets.map((s) => s.vehicle)).toEqual(['GD12345', 'WE1KR10']);
    const summary = driverSummary(list, name);
    expect(summary.find((r) => r.driver === 'Teodorczyk')).toMatchObject({ sluzbowy: 5548, prywatny: 0 });
    expect(summary.find((r) => r.driver === 'Jan Nowak')).toMatchObject({ sluzbowy: 0, prywatny: 40 });
    expect(JSON.stringify(mileageDocument({ kind: 'prywatny', month: '2026-10', taxpayer, sheets: privateSheets }).content)).toContain('Teodorczyk');
    expect(
      isPdf(await render(mileageDocument({ kind: 'prywatny', month: '2026-10', taxpayer, sheets: privateSheets, summary }), 'kilometrowka-prywatne.pdf')),
    ).toBe(true);
    expect(isPdf(await render(mileageDocument({ kind: 'sluzbowy', month: '2026-11', taxpayer: '', sheets: [] }), 'kilometrowka-pusta.pdf'))).toBe(true);
  });

  it('kolejne przejazdy z jednego dnia to jeden wpis z całą trasą', () => {
    const a = { ...trip('2026-10-02', 'sluzbowy', 100, 150), from: 'Łódź', to: 'Kutno', vehicle: 'WE1KR10' };
    const b = { ...trip('2026-10-02', 'sluzbowy', 150, 205), from: 'Kutno', to: 'Łódź', vehicle: 'WE1KR10' };
    const gap = { ...trip('2026-10-02', 'sluzbowy', 230, 240), from: 'Łódź', to: 'Łódź', vehicle: 'WE1KR10' };
    const [sheet] = mileageSheets([gap, b, a], 'sluzbowy', '2026-10', () => 'Maurycy');
    expect(sheet.entries.map((e) => [e.route, e.km, e.odometerStart, e.odometerEnd])).toEqual([
      ['Łódź - Kutno - Łódź', 105, 100, 205],
      ['Łódź', 10, 230, 240],
    ]);
  });
});
