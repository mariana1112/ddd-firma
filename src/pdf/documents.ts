// Budowa dokumentów jako czyste funkcje: dane wchodzą, definicja pdfmake wychodzi.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { jobTotals } from '../data/calc';
import type { Client, CompanySettings, Job, Site } from '../data/types';
import { addDays, formatDate, formatTerm } from '../lib/dates';
import { CATEGORIES, joinAddress, STATION_STATES, vatLabel } from '../lib/labels';
import { formatMoney, formatQty, lineNet } from '../lib/money';

const INK = '#1c1f1d';
const MUTED = '#5f655f';
const RULE = '#c9c7bf';
const ACCENT = '#0f5c50';

const baseDoc = (company: CompanySettings): Partial<TDocumentDefinitions> => ({
  pageSize: 'A4',
  pageMargins: [40, 40, 40, 50],
  defaultStyle: { font: 'Roboto', fontSize: 10, color: INK, lineHeight: 1.2 },
  styles: {
    title: { fontSize: 15, bold: true, color: ACCENT },
    section: { fontSize: 10.5, bold: true, color: ACCENT, margin: [0, 12, 0, 4] },
    th: { bold: true, fontSize: 9, color: MUTED },
    small: { fontSize: 8.5, color: MUTED },
  },
  footer: (page: number, pages: number) => ({
    margin: [40, 16, 40, 0],
    columns: [
      { text: company.protocolFooter || company.name, style: 'small' },
      { text: `Strona ${page} z ${pages}`, alignment: 'right', style: 'small', width: 70 },
    ],
  }),
});

const tableLayout = {
  hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: () => RULE,
  paddingLeft: (i: number) => (i === 0 ? 0 : 5),
  paddingRight: () => 5,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

function companyHeader(company: CompanySettings): Content {
  const lines = [
    company.name && { text: company.name, bold: true, fontSize: 11 },
    company.owner,
    joinAddress(company.street, company.postalCode, company.city),
    company.nip && `NIP: ${company.nip}${company.regon ? `, REGON: ${company.regon}` : ''}`,
    [company.phone && `tel. ${company.phone}`, company.email].filter(Boolean).join(', '),
  ].filter(Boolean) as Content[];
  return {
    columns: [
      { stack: lines, width: '*' },
      company.logoDataUrl
        ? { image: company.logoDataUrl, fit: [110, 56], alignment: 'right', width: 110 }
        : { text: '', width: 0 },
    ],
    margin: [0, 0, 0, 14],
  };
}

function kv(rows: Array<[string, string | null | undefined]>): Content {
  const filled = rows.filter(([, value]) => value);
  if (filled.length === 0) return { text: '' };
  return {
    layout: 'noBorders',
    table: {
      widths: [108, '*'],
      body: filled.map(([label, value]) => [{ text: label, color: MUTED }, { text: value as string }]),
    },
  };
}

function partyBlock(client: Client): string {
  return [
    client.name,
    client.contactPerson,
    joinAddress(client.street, client.postalCode, client.city),
    client.nip && `NIP: ${client.nip}`,
    client.phone && `tel. ${client.phone}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function placeOf(client: Client, site: Site | null): string {
  if (site) {
    const address = joinAddress(site.street, site.postalCode, site.city);
    return [site.name, address].filter(Boolean).join(', ');
  }
  return joinAddress(client.street, client.postalCode, client.city);
}

export interface JobDocumentData {
  job: Job;
  client: Client;
  site: Site | null;
  company: CompanySettings;
  /** Zdjęcia jako data URL JPEG lub PNG. */
  photos?: string[];
}

export function protocolDocument({ job, client, site, company, photos = [] }: JobDocumentData): TDocumentDefinitions {
  const materials: TableCell[][] = job.materials.map((m) => [
    m.name,
    m.activeSubstance || '—',
    m.permitNo || '—',
    m.batchNo || '—',
    { text: `${formatQty(m.qtyMilli)} ${m.unit}`, alignment: 'right', noWrap: true },
  ]);

  const signature = (label: string, name: string, image: string | null): Content => ({
    stack: [
      // Pole podpisu ma stały format, więc oba podpisy kończą się na tej samej wysokości.
      image
        ? { image, fit: [190, 60], alignment: 'center' }
        : { canvas: [{ type: 'rect', x: 0, y: 0, w: 1, h: 60, color: '#ffffff', lineColor: '#ffffff' }] },
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 0.5, lineColor: MUTED }],
        margin: [0, 2, 0, 3],
      },
      { text: label, style: 'small' },
      { text: name, fontSize: 9 },
    ],
    unbreakable: true,
  });

  return {
    ...baseDoc(company),
    info: { title: `Protokół ${job.number}`, creator: 'DDD Firma' },
    content: [
      companyHeader(company),
      { text: 'Protokół wykonania usługi DDD', style: 'title' },
      { text: `nr ${job.number}, data wykonania: ${formatDate(job.completedOn)}`, margin: [0, 2, 0, 0] },

      { text: 'Zleceniodawca', style: 'section' },
      { text: partyBlock(client) },

      { text: 'Zakres usługi', style: 'section' },
      kv([
        ['Miejsce wykonania', placeOf(client, site)],
        ['Rodzaj usługi', CATEGORIES[job.category]],
        ['Usługa', job.title],
        ['Szkodnik', job.pest],
        ['Metoda', job.method],
        ['Zakres / powierzchnia', job.scope],
      ]),

      { text: 'Użyte preparaty', style: 'section' },
      materials.length > 0
        ? {
            layout: tableLayout,
            table: {
              headerRows: 1,
              widths: ['*', 90, 80, 70, 50],
              body: [
                [
                  { text: 'Preparat', style: 'th' },
                  { text: 'Substancja czynna', style: 'th' },
                  { text: 'Nr pozwolenia', style: 'th' },
                  { text: 'Partia', style: 'th' },
                  { text: 'Ilość', style: 'th', alignment: 'right' },
                ],
                ...materials,
              ],
            },
          }
        : { text: 'Nie użyto preparatów.', color: MUTED },

      ...(job.stationChecks.length > 0
        ? ([
            { text: 'Przegląd stacji deratyzacyjnych', style: 'section' },
            {
              layout: tableLayout,
              table: {
                headerRows: 1,
                keepWithHeaderRows: 1,
                dontBreakRows: true,
                widths: [35, 95, '*', 80, 120],
                body: [
                  ['Nr', 'Typ', 'Miejsce', 'Stan', 'Uwagi'].map((text) => ({ text, style: 'th' })),
                  ...job.stationChecks.map((check) => [
                    check.number,
                    check.type || '—',
                    check.location || '—',
                    STATION_STATES[check.state],
                    check.notes || '—',
                  ]),
                ],
              },
            },
          ] as Content[])
        : []),

      ...(job.safetyPeriod || job.recommendations
        ? ([
            { text: 'Zalecenia po wykonaniu usługi', style: 'section' },
            job.safetyPeriod ? { text: `Okres karencji / prewencji: ${job.safetyPeriod}`, margin: [0, 0, 0, 3] } : '',
            job.recommendations ? { text: job.recommendations } : '',
          ] as Content[])
        : []),

      ...(job.warrantyUntil || job.followUpDate
        ? ([
            { text: 'Gwarancja i kolejna wizyta', style: 'section' },
            kv([
              ['Gwarancja do', job.warrantyUntil && formatDate(job.warrantyUntil)],
              ['Zalecana kolejna wizyta', job.followUpDate && formatDate(job.followUpDate)],
            ]),
          ] as Content[])
        : []),

      {
        columns: [
          signature('Wykonawca', company.owner || company.name, null),
          signature('Zleceniodawca, usługę odebrał(a)', job.signerName, job.signatureDataUrl),
        ],
        columnGap: 30,
        margin: [0, 26, 0, 0],
      },

      ...(photos.length > 0
        ? ([
            { text: 'Dokumentacja zdjęciowa', style: 'section', pageBreak: 'before' },
            ...photos.map((image) => ({ image, fit: [515, 340], margin: [0, 0, 0, 10] })),
          ] as Content[])
        : []),
    ],
  } as TDocumentDefinitions;
}

export function offerDocument({ job, client, site, company }: JobDocumentData, today: string): TDocumentDefinitions {
  const totals = jobTotals(job.lines);
  const money = (grosze: number, extra: object = {}): TableCell => ({
    text: formatMoney(grosze),
    alignment: 'right',
    noWrap: true,
    ...extra,
  });

  const rows: TableCell[][] = job.lines.map((line) => [
    line.name,
    { text: `${formatQty(line.qtyMilli)} ${line.unit}`, alignment: 'right', noWrap: true },
    money(line.unitPriceNet),
    { text: company.vatPayer ? vatLabel(line.vatRate) : '—', alignment: 'right' },
    money(lineNet(line.qtyMilli, line.unitPriceNet)),
  ]);

  const summary: Array<[string, number, boolean]> = company.vatPayer
    ? [
        ['Razem netto', totals.net, false],
        ['VAT', totals.vat, false],
        ['Do zapłaty brutto', totals.gross, true],
      ]
    : [['Do zapłaty', totals.gross, true]];

  return {
    ...baseDoc(company),
    info: { title: `Oferta ${job.number}`, creator: 'DDD Firma' },
    content: [
      companyHeader(company),
      { text: 'Oferta na usługę DDD', style: 'title' },
      {
        text: `nr ${job.number}, data: ${formatDate(today)}, ważna do: ${formatDate(addDays(today, company.offerValidityDays))}`,
        margin: [0, 2, 0, 0],
      },

      { text: 'Dla', style: 'section' },
      { text: partyBlock(client) },

      { text: 'Zakres', style: 'section' },
      kv([
        ['Miejsce wykonania', placeOf(client, site)],
        ['Rodzaj usługi', CATEGORIES[job.category]],
        ['Usługa', job.title],
        ['Szkodnik', job.pest],
        ['Metoda', job.method],
        ['Zakres / powierzchnia', job.scope],
        ['Proponowany termin', job.start && formatTerm(job.start)],
      ]),

      { text: 'Wycena', style: 'section' },
      {
        layout: tableLayout,
        table: {
          headerRows: 1,
          widths: ['*', 55, 70, 35, 75],
          body: [
            [
              { text: 'Pozycja', style: 'th' },
              { text: 'Ilość', style: 'th', alignment: 'right' },
              { text: company.vatPayer ? 'Cena netto' : 'Cena', style: 'th', alignment: 'right' },
              { text: 'VAT', style: 'th', alignment: 'right' },
              { text: company.vatPayer ? 'Wartość netto' : 'Wartość', style: 'th', alignment: 'right' },
            ],
            ...rows,
          ],
        },
      },
      {
        margin: [0, 8, 0, 0],
        layout: 'noBorders',
        table: {
          widths: ['*', 110, 75],
          body: summary.map(([label, value, strong]) => [
            '',
            { text: label, alignment: 'right', bold: strong },
            money(value, { bold: strong }),
          ]),
        },
      },
      ...(company.vatPayer ? [] : ([{ text: 'Sprzedawca zwolniony z VAT.', style: 'small', margin: [0, 6, 0, 0] }] as Content[])),
      ...(job.notes ? ([{ text: 'Uwagi', style: 'section' }, { text: job.notes }] as Content[]) : []),
      ...(company.bankAccount
        ? ([{ text: `Numer konta: ${company.bankAccount}`, margin: [0, 14, 0, 0], style: 'small' }] as Content[])
        : []),
    ],
  } as TDocumentDefinitions;
}

export interface UsageRow {
  date: string;
  jobNumber: string;
  client: string;
  place: string;
  preparation: string;
  permitNo: string;
  batchNo: string;
  qty: string;
}

export function usageDocument(rows: UsageRow[], from: string, to: string, company: CompanySettings): TDocumentDefinitions {
  return {
    ...baseDoc(company),
    pageOrientation: 'landscape',
    info: { title: 'Ewidencja zużycia preparatów', creator: 'DDD Firma' },
    content: [
      companyHeader(company),
      { text: 'Ewidencja zużycia preparatów', style: 'title' },
      { text: `Okres: ${formatDate(from)} – ${formatDate(to)}`, margin: [0, 2, 0, 10] },
      rows.length > 0
        ? {
            layout: tableLayout,
            table: {
              headerRows: 1,
              widths: [55, 65, '*', '*', 110, 70, 60, 45],
              body: [
                ['Data', 'Zlecenie', 'Klient', 'Miejsce', 'Preparat', 'Nr pozwolenia', 'Partia', 'Ilość'].map((text, i) => ({
                  text,
                  style: 'th',
                  alignment: i === 7 ? 'right' : 'left',
                })),
                ...rows.map((r) => [
                  formatDate(r.date),
                  r.jobNumber,
                  r.client,
                  r.place,
                  r.preparation,
                  r.permitNo || '—',
                  r.batchNo || '—',
                  { text: r.qty, alignment: 'right', noWrap: true },
                ]),
              ],
            },
          }
        : { text: 'Brak zużycia w tym okresie.', color: MUTED },
    ],
  } as TDocumentDefinitions;
}
