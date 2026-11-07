import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { EMPTY_INTERVIEW } from '../data/orders';
import { buildReport, periodOf } from '../data/reports';
import type { Expense, Order, Trip, Visit } from '../data/types';
import { reportDocument, tripsDocument } from './documents';

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

  it('kilometrówka służbowa i prywatna', async () => {
    const list = [trip('2026-10-27', 'sluzbowy', 1000, 1032), trip('2026-10-28', 'sluzbowy', 1032, 1110)];
    expect(isPdf(await render(tripsDocument(list, 'sluzbowy', '2026-10', 'Maurycy'), 'kilometrowka.pdf'))).toBe(true);
    expect(isPdf(await render(tripsDocument([], 'prywatny', '2026-10', ''), 'kilometrowka-pusta.pdf'))).toBe(true);
  });
});
