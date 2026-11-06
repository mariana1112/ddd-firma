import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Client, CompanySettings, Job, JobStationCheck, Site } from '../data/types';
import { offerDocument, protocolDocument, usageDocument, type JobDocumentData } from './documents';

const require = createRequire(import.meta.url);
const stamps = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', deletedAt: null };

const company: CompanySettings = {
  name: 'Żółta Pszczółka Usługi DDD',
  owner: 'Łukasz Śliwiński',
  nip: '5260001246',
  regon: '123456785',
  street: 'ul. Świętokrzyska 12',
  postalCode: '00-050',
  city: 'Łódź',
  phone: '500600700',
  email: 'biuro@example.com',
  bankAccount: '12 3456 7890 1234 5678 9012 3456',
  logoDataUrl: null,
  vatPayer: true,
  defaultVatRate: 23,
  offerValidityDays: 30,
  protocolFooter: 'Usługi wykonywane zgodnie z etykietą preparatu.',
};

const client: Client = {
  ...stamps,
  id: 'c1',
  kind: 'firma',
  name: 'Gęś i Żuraw Sp. z o.o.',
  contactPerson: 'Ćma Źródlana',
  nip: '5260001246',
  phone: '600700800',
  email: '',
  street: 'Różana 3',
  postalCode: '90-001',
  city: 'Łódź',
  notes: '',
};

const site: Site = {
  ...stamps,
  id: 's1',
  clientId: 'c1',
  name: 'Restauracja Żabka',
  objectType: 'Restauracja / gastronomia',
  street: 'Pańska 5',
  postalCode: '90-002',
  city: 'Łódź',
  areaM2: 120,
  accessNotes: '',
  stations: [],
};

const job: Job = {
  ...stamps,
  id: 'j1',
  number: 'Z/2026/0007',
  clientId: 'c1',
  siteId: 's1',
  status: 'wykonane',
  start: '2026-11-04T09:30',
  durationMin: 90,
  category: 'dezynsekcja',
  title: 'Zwalczanie karaczanów w kuchni',
  pest: 'Karaczany',
  method: 'Żel + oprysk',
  scope: 'Kuchnia i zaplecze, 120 m²',
  notes: 'Dojazd od ulicy Łąkowej.',
  lines: [
    { id: 'l1', name: 'Dezynsekcja żelowa', unit: 'usł.', qtyMilli: 1000, unitPriceNet: 45000, vatRate: 23 },
    { id: 'l2', name: 'Oprysk zaplecza', unit: 'm²', qtyMilli: 120000, unitPriceNet: 250, vatRate: 8 },
  ],
  materials: [
    {
      id: 'm1',
      preparationId: 'p1',
      name: 'Żel Pogromca',
      permitNo: 'PL/2024/0123',
      activeSubstance: 'imidachlopryd',
      batchNo: 'B-77',
      qtyMilli: 35,
      unit: 'kg',
    },
  ],
  stationChecks: [],
  completedOn: '2026-11-04',
  recommendations: 'Nie myć podłóg przez 3 dni. Wietrzyć pomieszczenia po zakończeniu zabiegu.',
  safetyPeriod: '4 godziny',
  warrantyUntil: '2027-02-04',
  followUpDate: '2027-05-04',
  followUpDone: false,
  invoiceNo: '',
  signerName: 'Ćma Źródlana',
  signatureDataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

const data: JobDocumentData = { job, client, site, company };

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

const STATION_SECTION = 'Przegląd stacji deratyzacyjnych';

/** Tabela stojąca w treści protokołu zaraz po nagłówku sekcji stacji, jeśli jest. */
function stationTable(definition: TDocumentDefinitions): unknown[][] | undefined {
  const content = definition.content as Array<{ text?: string; table?: { body: unknown[][] } }>;
  const heading = content.findIndex((node) => node.text === STATION_SECTION);
  return heading === -1 ? undefined : content[heading + 1].table?.body;
}

const checks: JobStationCheck[] = [
  { stationId: 'st1', number: '2', type: 'Stacja zewnętrzna', location: 'Rampa, ściana północna', state: 'slady-zerowania', notes: 'Wymieniono połowę żeru' },
  { stationId: 'st2', number: '10', type: '', location: '', state: 'bez-sladow', notes: '' },
];

describe('dokumenty PDF', () => {
  it('protokół ma tabelę przeglądu stacji', async () => {
    const definition = protocolDocument({ ...data, job: { ...job, stationChecks: checks } });
    const body = stationTable(definition)!;
    expect(body).toHaveLength(3);
    expect((body[0] as Array<{ text: string }>).map((cell) => cell.text)).toEqual(['Nr', 'Typ', 'Miejsce', 'Stan', 'Uwagi']);
    expect(body[1]).toEqual(['2', 'Stacja zewnętrzna', 'Rampa, ściana północna', 'Ślady żerowania', 'Wymieniono połowę żeru']);
    expect(body[2]).toEqual(['10', '—', '—', 'Bez śladów', '—']);
    expect(isPdf(await render(definition, 'protokol-stacje.pdf'))).toBe(true);
  });

  it('protokół bez przeglądu nie ma sekcji stacji', () => {
    expect(stationTable(protocolDocument(data))).toBeUndefined();
  });

  it('długi przegląd stacji przechodzi na kolejne strony', async () => {
    const many: JobStationCheck[] = Array.from({ length: 80 }, (_, i) => ({
      ...checks[0],
      stationId: `st${i}`,
      number: String(i + 1),
    }));
    const definition = protocolDocument({ ...data, job: { ...job, stationChecks: many } });
    expect(isPdf(await render(definition, 'protokol-stacje-dlugi.pdf'))).toBe(true);
  });

  it('protokół', async () => {
    expect(isPdf(await render(protocolDocument(data), 'protokol.pdf'))).toBe(true);
  });

  it('protokół bez preparatów, podpisu i dat', async () => {
    const empty = {
      ...job,
      materials: [],
      signatureDataUrl: null,
      warrantyUntil: null,
      followUpDate: null,
      safetyPeriod: '',
      recommendations: '',
    };
    expect(isPdf(await render(protocolDocument({ ...data, job: empty, site: null }), 'protokol-pusty.pdf'))).toBe(true);
  });

  it('oferta dla płatnika VAT i bez VAT', async () => {
    expect(isPdf(await render(offerDocument(data, '2026-11-04'), 'oferta.pdf'))).toBe(true);
    const noVat = { ...data, company: { ...company, vatPayer: false } };
    expect(isPdf(await render(offerDocument(noVat, '2026-11-04'), 'oferta-bez-vat.pdf'))).toBe(true);
  });

  it('ewidencja zużycia, także pusta', async () => {
    const row = {
      date: '2026-11-04',
      jobNumber: 'Z/2026/0007',
      client: client.name,
      place: 'Pańska 5, Łódź',
      preparation: 'Żel Pogromca',
      permitNo: 'PL/2024/0123',
      batchNo: 'B-77',
      qty: '0,035 kg',
    };
    expect(isPdf(await render(usageDocument([row], '2026-11-01', '2026-11-30', company), 'ewidencja.pdf'))).toBe(true);
    expect(isPdf(await render(usageDocument([], '2026-11-01', '2026-11-30', company), 'ewidencja-pusta.pdf'))).toBe(true);
  });
});
