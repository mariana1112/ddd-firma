// Dokumenty PDF jako czyste funkcje: dane wchodzą, definicja pdfmake wychodzi.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { tripKm } from '../data/orders';
import { formatPln, PAY_METHODS, periodTitle, type Report } from '../data/reports';
import { COMPANY_NAME } from '../data/settings';
import { orderAddress, PAY_NAMES, pestName } from '../data/texts';
import type { Trip, TripKind } from '../data/types';
import { formatDate, formatMonth } from '../lib/dates';

const INK = '#1c1f1d';
const MUTED = '#5f655f';
const RULE = '#c9c7bf';
const ACCENT = '#0f5c50';

const tableLayout = {
  hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: () => RULE,
  paddingLeft: (i: number) => (i === 0 ? 0 : 4),
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

const gridLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => INK,
  vLineColor: () => INK,
  paddingLeft: () => 3,
  paddingRight: () => 3,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

function base(title: string, orientation: 'portrait' | 'landscape' = 'portrait'): Partial<TDocumentDefinitions> {
  return {
    pageSize: 'A4',
    pageOrientation: orientation,
    pageMargins: [36, 36, 36, 44],
    info: { title, creator: COMPANY_NAME },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: INK, lineHeight: 1.15 },
    styles: {
      title: { fontSize: 15, bold: true, color: ACCENT },
      section: { fontSize: 10.5, bold: true, color: ACCENT, margin: [0, 12, 0, 4] },
      th: { bold: true, fontSize: 8.5, color: MUTED },
      small: { fontSize: 8, color: MUTED },
    },
    footer: (page: number, pages: number) => ({
      margin: [36, 14, 36, 0],
      columns: [
        { text: COMPANY_NAME, style: 'small' },
        { text: `Strona ${page} z ${pages}`, alignment: 'right', style: 'small', width: 80 },
      ],
    }),
  };
}

const right = (text: string, extra: object = {}): TableCell => ({ text, alignment: 'right', noWrap: true, ...extra });

/** Raport rozliczeniowy: obrót, formy płatności, koszty, premia, gotówka dla szefa i szczegóły. */
export function reportDocument(report: Report, names: { technician: string; bossGenitive: string }): TDocumentDefinitions {
  const summary: Array<[string, number, boolean?]> = [
    ['Obrót', report.turnover, true],
    ...PAY_METHODS.map((m): [string, number] => [PAY_NAMES[m], report.byMethod[m]]),
    [`Parkingi oraz autostrady (zwrot ${names.technician})`, report.refunds],
    [`Premia ${names.technician}`, report.bonus],
    ['Inne koszty', report.otherCosts],
    [`Wynik gotówka dla ${names.bossGenitive}`, report.cashForBoss, true],
  ];

  const days: Content =
    report.days.length > 0
      ? {
          layout: tableLayout,
          table: {
            headerRows: 1,
            widths: ['*', 70, 70, 70, 70],
            body: [
              [{ text: 'Dzień', style: 'th' }, right('Gotówka', { style: 'th' }), right('BLIK', { style: 'th' }), right('Przelew', { style: 'th' }), right('Razem', { style: 'th' })],
              ...report.days.map((d) => [
                formatDate(d.date),
                right(formatPln(d.gotowka)),
                right(formatPln(d.blik)),
                right(formatPln(d.przelew)),
                right(formatPln(d.gotowka + d.blik + d.przelew), { bold: true }),
              ]),
            ],
          },
        }
      : { text: 'Brak wpłat w tym okresie.', color: MUTED };

  const visits: Content =
    report.visits.length > 0
      ? {
          layout: tableLayout,
          table: {
            headerRows: 1,
            widths: [52, 34, '*', 70, 52, 56],
            body: [
              ['Data', 'Nr', 'Adres i szkodnik', 'Klient', 'Forma', 'Kwota'].map((t, i) => (i === 5 ? right(t, { style: 'th' }) : { text: t, style: 'th' })),
              ...report.visits.map(({ visit, order }) => [
                formatDate(visit.doneOn),
                order ? `#${order.number}` : '—',
                order ? `${orderAddress(order)}\n${pestName(order)}, zabieg ${visit.seq}` : '—',
                order?.clientName ?? '—',
                visit.payMethod ? PAY_NAMES[visit.payMethod] : '—',
                right(visit.amount ? formatPln(visit.amount) : '—'),
              ]),
            ],
          },
        }
      : { text: 'Brak wykonanych zabiegów.', color: MUTED };

  const costs: Content =
    report.expenses.length > 0
      ? {
          layout: tableLayout,
          table: {
            headerRows: 1,
            widths: [60, 80, '*', 60],
            body: [
              [{ text: 'Data', style: 'th' }, { text: 'Kategoria', style: 'th' }, { text: 'Opis', style: 'th' }, right('Kwota', { style: 'th' })],
              ...report.expenses.map((e) => [formatDate(e.date), e.category, e.description || '—', right(formatPln(e.amount))]),
            ],
          },
        }
      : { text: 'Brak kosztów.', color: MUTED };

  return {
    ...base(`Raport ${periodTitle(report)}`),
    content: [
      { text: COMPANY_NAME, bold: true, fontSize: 11 },
      { text: `Raport ${periodTitle(report)}`, style: 'title', margin: [0, 4, 0, 2] },
      { text: `Technik: ${names.technician}`, color: MUTED },
      { text: 'Rozliczenie', style: 'section' },
      {
        layout: tableLayout,
        table: {
          widths: ['*', 90],
          body: summary.map(([label, value, strong]) => [{ text: label, bold: strong }, right(formatPln(value), { bold: strong })]),
        },
      },
      { text: 'Wpłaty według dni', style: 'section' },
      days,
      { text: 'Zabiegi', style: 'section' },
      visits,
      { text: 'Koszty', style: 'section' },
      costs,
      { text: 'Kilometry', style: 'section' },
      { text: `Służbowe: ${report.km.sluzbowy} km, prywatne: ${report.km.prywatny} km` },
    ],
  } as TDocumentDefinitions;
}

/** Ewidencja przejazdów do wydruku, osobno służbowych i prywatnych. */
export function tripsDocument(trips: Trip[], kind: TripKind, month: string, ownerName: string): TDocumentDefinitions {
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.timeFrom.localeCompare(b.timeFrom));
  const total = sorted.reduce((s, t) => s + tripKm(t), 0);
  const title = `Ewidencja przejazdów ${kind === 'sluzbowy' ? 'służbowych' : 'prywatnych'}`;
  const header = ['Lp.', 'Data', 'Godz. od–do', 'Skąd', 'Dokąd', kind === 'sluzbowy' ? 'Cel wyjazdu' : 'Uwagi', 'Licznik przed', 'Licznik po', 'Km'];

  return {
    ...base(title, 'landscape'),
    content: [
      { text: COMPANY_NAME, bold: true, fontSize: 11 },
      { text: title, style: 'title', margin: [0, 4, 0, 2] },
      { text: `Miesiąc: ${formatMonth(month)}${ownerName ? `, kierowca: ${ownerName}` : ''}`, margin: [0, 0, 0, 10] },
      {
        layout: gridLayout,
        table: {
          headerRows: 1,
          widths: [22, 54, 62, '*', '*', '*', 58, 58, 40],
          body: [
            header.map((t) => ({ text: t, bold: true, fontSize: 8.5, alignment: 'center' as const, fillColor: '#ecebe6' })),
            ...sorted.map((t, i) => [
              { text: String(i + 1), alignment: 'center' as const },
              formatDate(t.date),
              `${t.timeFrom}${t.timeTo ? `–${t.timeTo}` : ''}`,
              t.from,
              t.to,
              t.purpose,
              right(String(t.odometerStart)),
              right(String(t.odometerEnd)),
              right(String(tripKm(t)), { bold: true }),
            ]),
            [{ text: 'Razem', colSpan: 8, alignment: 'right' as const, bold: true }, '', '', '', '', '', '', '', right(String(total), { bold: true })],
          ],
        },
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 200,
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: MUTED }], margin: [0, 40, 0, 3] },
              { text: 'Podpis', style: 'small', alignment: 'center' },
            ],
          },
        ],
      },
    ],
  } as TDocumentDefinitions;
}
