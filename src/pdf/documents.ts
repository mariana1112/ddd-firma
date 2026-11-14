import { orderCode, roman, visitCode } from '../data/codes';
import { methodNames } from '../data/methods';
// Dokumenty PDF jako czyste funkcje: dane wchodzą, definicja pdfmake wychodzi.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { FIRST_PAGE_ROWS, NEXT_PAGE_ROWS, paginate, romanMonth, type DriverSummary, type MileageEntry } from '../data/mileage';
import { byTechnician, formatPln, PAY_METHODS, periodTitle, type Report } from '../data/reports';
import { COMPANY_NAME } from '../data/settings';
import { BUILDINGS, INVOICES, interviewLines, orderAddress, PAY_NAMES, pestName, priceRange, workSummary } from '../data/texts';
import { scopeText, visitPrice } from '../data/visit-terms';
import type { Order, TripKind, Visit } from '../data/types';
import { formatDate, formatTerm } from '../lib/dates';

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
export function reportDocument(report: Report, names: { technician: string; bossGenitive: string }, opts: { km?: boolean; split?: boolean } = {}): TDocumentDefinitions {
  const summary: Array<[string, number, boolean?]> = [
    ['Obrót', report.turnover, true],
    ...PAY_METHODS.map((m): [string, number] => [PAY_NAMES[m], report.byMethod[m]]),
    ['Premia', report.bonus],
    ...report.costLines.map((c): [string, number] => [c.name, c.amount]),
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
            widths: [52, 62, '*', 64, 46, 56],
            body: [
              ['Data', 'Nr', 'Adres i szkodnik', 'Klient', 'Forma', 'Kwota'].map((t, i) => (i === 5 ? right(t, { style: 'th' }) : { text: t, style: 'th' })),
              ...report.visits.map(({ visit, order }) => [
                formatDate(visit.doneOn),
                order ? visitCode(order, visit.seq) : '—',
                order ? `${orderAddress(order)}\n${pestName(order)}, zabieg ${roman(visit.seq)}` : '—',
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
      // Raport regionu: kto ile zrobił (inicjały technika).
      ...(opts.split
        ? [
            { text: 'Podział na techników', style: 'section' } as Content,
            {
              layout: tableLayout,
              table: {
                widths: [50, '*', 60, 80],
                body: [
                  [{ text: 'Technik', style: 'th' }, { text: 'Imię i nazwisko', style: 'th' }, { text: 'Zabiegi', style: 'th', alignment: 'right' }, { text: 'Obrót', style: 'th', alignment: 'right' }],
                  ...byTechnician(report).map((s) => [{ text: s.label, bold: true }, s.name, right(String(s.visits)), right(formatPln(s.turnover))]),
                ],
              },
            } as Content,
          ]
        : []),
      { text: 'Zabiegi', style: 'section' },
      visits,
      { text: 'Koszty', style: 'section' },
      costs,
      // Kilometry tylko na życzenie („Z kilometrami” w Raportach).
      ...(opts.km
        ? [
            { text: 'Kilometry', style: 'section' } as Content,
            { text: `Służbowe (do ewidencji VAT): ${report.km.sluzbowy} km, w tym prywatne: ${report.km.prywatny} km` } as Content,
          ]
        : []),
    ],
  } as TDocumentDefinitions;
}

// ---------- Kilometrówka ----------
// Układ odwzorowuje formularz „Ewidencja przebiegu pojazdu dla celów VAT”: pierwsza strona
// z danymi podatnika i 17 wpisami, kolejne po 23 wpisy, pod tabelą sumy strony z przeniesieniem.

// pdfmake zamienia tablicę szerokości w miejscu na obiekty, więc każda tabela dostaje własną kopię.
const FORM_WIDTHS: readonly number[] = Object.freeze([29, 64, 90, 165, 45, 84, 62]);
/** Wysokość połowy wpisu: wpis ma dwa wiersze, bo ostatnia kolumna mieści dwa stany licznika. */
const HALF_ROW = 12.4;
const SUM_ROW = 15;
const BLACK = '#000000';
const PEN = '#14306b';

const sup = (n: number): Content => ({ text: `${n})`, sup: true, fontSize: 5.5 });
const struck = (text: string): Content => ({ text, decoration: 'lineThrough' });
const filled = (value: string | number): Content => ({ text: String(value), bold: true, fontSize: 10.5, color: PEN });

const formLayout = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => BLACK,
  vLineColor: () => BLACK,
  paddingLeft: () => 2,
  paddingRight: () => 2,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};

/** Pozioma kreska: tabela z jedną krawędzią, bo kreski z canvas pdfmake gubi w stosie. */
type Margins4 = [number, number, number, number];

function rule(width: number, opts: { dashed?: boolean; margin?: Margins4 } = {}): Content {
  return {
    table: { widths: [width], body: [[{ text: '', fontSize: 1 }]] },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 0.6 : 0),
      vLineWidth: () => 0,
      hLineStyle: () => (opts.dashed ? { dash: { length: 1, space: 1.5 } } : null),
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: opts.margin ?? [0, 0, 0, 0],
  } as Content;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function headCell(parts: Array<string | Content>, extra: object = {}): TableCell {
  const lines = parts.filter((p) => typeof p === 'string').join('').split('\n').length;
  return { text: parts, bold: true, fontSize: 7, alignment: 'center', margin: [0, Math.max(2, (6 - lines) * 4), 0, 2], ...extra } as TableCell;
}

/** Komórka wpisu na dwie połowy wiersza. Dłuższy tekst dostaje mniejszą czcionkę, żeby wpis się nie rozjechał. */
function bigCell(text: string, opts: { width: number; size?: number; bold?: boolean; align?: 'left' | 'center' }): TableCell {
  const size = opts.size ?? 8;
  const perLine = Math.floor(opts.width / (size * 0.52));
  const fontSize = text.length > perLine * 2 ? Math.max(5.5, size - 2) : text.length > perLine ? size - 0.8 : size;
  const oneLine = text.length <= perLine;
  return {
    text,
    rowSpan: 2,
    fontSize,
    bold: opts.bold,
    color: PEN,
    alignment: opts.align ?? 'center',
    margin: [0, oneLine ? HALF_ROW - fontSize * 0.62 : 1.5, 0, 0],
  } as TableCell;
}

export interface MileageSheet {
  vehicle: string;
  entries: MileageEntry[];
}

export interface MileageOptions {
  kind: TripKind;
  month: string;
  /** Dane podatnika: nazwa, adres, NIP. */
  taxpayer: string;
  sheets: MileageSheet[];
  /** Zestawienie kierowców na ostatniej stronie wydruku prywatnych. */
  summary?: DriverSummary[];
}

function formTable(vat: boolean, entries: Array<MileageEntry | null>, firstNo: number, purpose: string): Content {
  const header: TableCell[][] = vat
    ? [
        [
          headCell(['Nr\nkolejny\nwpisu'], { rowSpan: 2 }),
          headCell(['Data\nwyjazdu/\nudostępnienia\npojazdu', sup(2)], { rowSpan: 2 }),
          headCell(['Opis trasy\nwyjazdu\n(skąd-dokąd)', sup(3)], { rowSpan: 2 }),
          headCell(['Cel wyjazdu/\nudostępnienia pojazdu', sup(2)], { rowSpan: 2 }),
          headCell(['Liczba\nfaktycznie\nprzejecha-\nnych\nkilometrów'], { rowSpan: 2 }),
          headCell(['Imię i nazwisko osoby\nkierującej pojazdem/\nosoby której\nudostępniony został\npojazd', sup(2)], { rowSpan: 2 }),
          headCell(['Stan licznika\nna dzień udostęp-\nnienia pojazdu', sup(2)], { margin: [0, 2, 0, 2] }),
        ],
        ['', '', '', '', '', '', headCell(['Stan licznika\nna dzień zwrotu\npojazdu', sup(2)], { margin: [0, 2, 0, 2] })],
      ]
    : [
        [
          headCell(['Nr\nkolejny\nwpisu'], { rowSpan: 2 }),
          headCell(['Data\nwyjazdu'], { rowSpan: 2 }),
          headCell(['Opis trasy\nwyjazdu\n(skąd-dokąd)'], { rowSpan: 2 }),
          headCell(['Cel wyjazdu'], { rowSpan: 2 }),
          headCell(['Liczba\nprzejecha-\nnych\nkilometrów'], { rowSpan: 2 }),
          headCell(['Imię i nazwisko\nosoby kierującej\npojazdem'], { rowSpan: 2 }),
          headCell(['Stan licznika\nprzed wyjazdem'], { margin: [0, 2, 0, 2] }),
        ],
        ['', '', '', '', '', '', headCell(['Stan licznika\npo powrocie'], { margin: [0, 2, 0, 2] })],
      ];

  const odo = (n: number | undefined): TableCell => ({
    text: n === undefined ? '' : String(n),
    alignment: 'center',
    fontSize: 8.5,
    color: PEN,
    margin: [0, 1, 0, 0],
  });
  const body: TableCell[][] = [...header];
  entries.forEach((e, i) => {
    body.push([
      bigCell(e ? String(firstNo + i) : '', { width: FORM_WIDTHS[0] }),
      bigCell(e ? formatDate(e.date) : '', { width: FORM_WIDTHS[1], size: 9 }),
      bigCell(e ? e.route : '', { width: FORM_WIDTHS[2], size: 7.5, align: 'left' }),
      bigCell(e ? purpose : '', { width: FORM_WIDTHS[3], size: 10, bold: true }),
      bigCell(e ? String(e.km) : '', { width: FORM_WIDTHS[4], size: 10, bold: true }),
      // W ewidencji VAT kolumna zostaje pusta do własnoręcznego wpisu; prywatne pokazują kierowcę.
      bigCell(e && !vat ? e.driver : '', { width: FORM_WIDTHS[5], size: 7.5 }),
      odo(e?.odometerStart),
    ]);
    body.push(['', '', '', '', '', '', odo(e?.odometerEnd)]);
  });

  return {
    layout: formLayout,
    table: { widths: [...FORM_WIDTHS], heights: (row: number) => (row < 2 ? 'auto' : HALF_ROW), body },
  } as Content;
}

function sumsBlock(vat: boolean, pageKm: number, carried: number): Content {
  const none = [false, false, false, false];
  const label = (text: string): TableCell => ({ text, bold: true, fontSize: 8.5, alignment: 'right', margin: [0, 3, 5, 0], border: none }) as TableCell;
  const box = (value: number): TableCell => ({ text: String(value), bold: true, fontSize: 9.5, color: PEN, alignment: 'center', margin: [0, 2, 0, 0] });
  const note: TableCell = vat
    ? ({
        text: [
          { text: 'UWAGA: ', bold: true },
          'W przypadku, gdy pojazd samochodowy jest udostępniany osobie niebędącej pracownikiem podatnika, ewidencję przebiegu pojazdu wypełnia osoba, która udostępnia pojazd.',
        ],
        bold: true,
        fontSize: 6.5,
        alignment: 'justify',
        rowSpan: 3,
        margin: [2, 3, 6, 0],
        border: none,
      } as TableCell)
    : ({ text: '', rowSpan: 3, border: none } as TableCell);
  const crossed = {
    rowSpan: 3,
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: FORM_WIDTHS[5] + FORM_WIDTHS[6], y2: SUM_ROW * 3, lineWidth: 0.6, lineColor: BLACK }],
  } as unknown as TableCell;
  return {
    layout: { ...formLayout, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    table: {
      widths: [FORM_WIDTHS[0] + FORM_WIDTHS[1] + FORM_WIDTHS[2], FORM_WIDTHS[3], FORM_WIDTHS[4], FORM_WIDTHS[5] + FORM_WIDTHS[6]],
      heights: SUM_ROW,
      body: [
        [note, label('Podsumowanie strony'), box(pageKm), crossed],
        ['', label('Z przeniesienia'), box(carried), ''],
        ['', label('Razem'), box(carried + pageKm), ''],
      ],
    },
  } as Content;
}

function sheetPages(opts: MileageOptions, sheet: MileageSheet, firstOfDocument: boolean): Content[] {
  const vat = opts.kind === 'sluzbowy';
  const purpose = vat ? 'SŁUŻBOWO' : 'PRYWATNIE';
  const roman = romanMonth(opts.month);
  const year = opts.month.slice(0, 4);
  const first = sheet.entries[0];
  const last = sheet.entries.at(-1);
  const total = sheet.entries.reduce((s, e) => s + e.km, 0);
  const startOdo = first ? first.odometerStart : '';
  const endOdo = last ? last.odometerEnd : '';
  const label: { fontSize: number; margin: Margins4 } = { fontSize: 8.5, margin: [0, 5, 0, 0] };

  const firstHeader: Content[] = vat
    ? [
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: opts.taxpayer || ' ', bold: true, fontSize: 9, color: PEN, margin: [0, 0, 10, 1] },
                rule(270, { dashed: true }),
                { text: 'Dane podatnika', fontSize: 8.5, margin: [0, 1, 0, 0] },
                { text: ['(nazwisko, imię/ nazwa', sup(1), ', adres prowadzonej działalności, NIP)'], fontSize: 5.5 },
                { text: ['Numer rejestracyjny pojazdu samochodowego   ', filled(sheet.vehicle)], ...label },
                { text: ['Dzień rozpoczęcia prowadzenia ewidencji   ', filled(formatDate(`${opts.month}-01`))], ...label },
                { text: ['Stan licznika przebiegu pojazdu na dzień\nrozpoczęcia prowadzenia ewidencji   ', filled(startOdo)], ...label },
              ],
            },
            {
              width: 250,
              stack: [
                { text: ['Dzień zakończenia prowadzenia ewidencji   ', filled(formatDate(lastDayOfMonth(opts.month)))], ...label, margin: [0, 26, 0, 0] },
                { text: ['Stan licznika przebiegu pojazdu na dzień\nzakończenia prowadzenia ewidencji   ', filled(endOdo)], ...label },
                { text: ['Liczba przejechanych kilometrów na dzień\nzakończenia prowadzenia ewidencji   ', filled(total)], ...label },
              ],
            },
          ],
        },
        { text: 'EWIDENCJA PRZEBIEGU POJAZDU DLA CELÓW VAT', bold: true, fontSize: 14.5, alignment: 'center', margin: [0, 10, 0, 1] },
        { text: ['za miesiąc / ', struck('kwartał'), sup(1), '  ', filled(roman), '  roku  ', filled(year)], bold: true, fontSize: 11, alignment: 'center' },
        {
          text: ['Stan licznika  ', filled(startOdo), '  na początek miesiąca / ', struck('kwartału'), sup(1), '  ', filled(roman), '  roku  ', filled(year)],
          fontSize: 8.5,
          margin: [0, 3, 0, 3],
        },
      ]
    : [
        { text: 'EWIDENCJA PRZEJAZDÓW PRYWATNYCH', bold: true, fontSize: 14.5, alignment: 'center', margin: [0, 0, 0, 1] },
        { text: ['za miesiąc  ', filled(roman), '  roku  ', filled(year)], bold: true, fontSize: 11, alignment: 'center' },
        {
          text: `Do wglądu pracodawcy (${COMPANY_NAME}), żeby rozdzielić jazdy prywatne od służbowych. Przejazdy prywatne nie są wpisywane do ewidencji przebiegu pojazdu dla celów VAT.`,
          fontSize: 8,
          alignment: 'center',
          margin: [30, 6, 30, 8],
        },
        {
          columns: [
            { text: ['Numer rejestracyjny pojazdu samochodowego   ', filled(sheet.vehicle)], fontSize: 8.5 },
            { text: ['Przejechano prywatnie   ', filled(`${total} km`)], fontSize: 8.5, alignment: 'right' },
          ],
          margin: [0, 0, 0, 6],
        },
      ];

  const bottomLine: Content = {
    columns: vat
      ? [
          {
            width: '*',
            text: ['Stan licznika  ', filled(endOdo), '  na koniec miesiąca / ', struck('kwartału'), sup(1), '  ', filled(roman), '  roku  ', filled(year)],
          },
          { width: 'auto', text: 'Podpis podatnika ...............................................' },
        ]
      : [
          { width: '*', text: ['Stan licznika po ostatnim przejeździe prywatnym  ', filled(endOdo)] },
          { width: 'auto', text: 'Podpis kierowcy ...............................................' },
        ],
    fontSize: 8.5,
    margin: [0, 9, 0, 3],
  } as Content;

  const footnotes: Content[] = vat
    ? [
        rule(130, { margin: [0, 2, 0, 1] }),
        { text: [sup(1), ' niepotrzebne skreślić,'], fontSize: 6 },
        { text: [sup(2), ' dotyczy sytuacji, gdy pojazd samochodowy jest udostępniany osobie niebędącej pracownikiem podatnika,'], fontSize: 6 },
        { text: [sup(3), ' nie wypełnia się, gdy pojazd samochodowy jest udostępniany osobie niebędącej pracownikiem podatnika.'], fontSize: 6 },
      ]
    : [];

  let carried = 0;
  let no = 1;
  return paginate(sheet.entries).map((rows, index) => {
    const capacity = index === 0 ? FIRST_PAGE_ROWS : NEXT_PAGE_ROWS;
    const padded: Array<MileageEntry | null> = [...rows, ...Array<null>(capacity - rows.length).fill(null)];
    const pageKm = rows.reduce((s, e) => s + e.km, 0);
    const page = {
      pageBreak: firstOfDocument && index === 0 ? undefined : 'before',
      stack: [
        { text: `strona ${index + 1}`, alignment: 'right', fontSize: 8.5, margin: [0, 0, 0, 2] },
        ...(index === 0 ? firstHeader : []),
        formTable(vat, padded, no, purpose),
        sumsBlock(vat, pageKm, carried),
        bottomLine,
        ...footnotes,
      ],
    } as Content;
    carried += pageKm;
    no += rows.length;
    return page;
  });
}

function summaryPage(month: string, summary: DriverSummary[]): Content {
  const th = (text: string, align: 'left' | 'right' = 'left'): TableCell => ({ text, bold: true, fontSize: 8.5, alignment: align, fillColor: '#ecebe6' });
  // Służbowo (VAT) obejmuje wszystkie kilometry; prywatne to ich część, pokazana do wglądu.
  const total = summary.reduce((acc, r) => ({ s: acc.s + r.sluzbowy, p: acc.p + r.prywatny }), { s: 0, p: 0 });
  return {
    pageBreak: 'before',
    stack: [
      { text: 'ZESTAWIENIE KILOMETRÓW KIEROWCÓW', bold: true, fontSize: 14.5, alignment: 'center' },
      { text: ['za miesiąc  ', filled(romanMonth(month)), '  roku  ', filled(month.slice(0, 4))], bold: true, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 12] },
      {
        layout: gridLayout,
        table: {
          headerRows: 1,
          widths: ['*', 110, 90, 90],
          body: [
            [th('Kierowca'), th('Pojazdy'), th('Służbowo (VAT) km', 'right'), th('w tym prywatne km', 'right')],
            ...summary.map((r) => [r.driver || '—', r.vehicles.join(', ') || '—', right(String(r.sluzbowy), { bold: true }), right(String(r.prywatny))]),
            [{ text: 'Razem', bold: true }, '', right(String(total.s), { bold: true }), right(String(total.p), { bold: true })],
          ],
        },
      },
    ],
  } as Content;
}

/** Kilometrówka do wydruku: służbowe na formularzu ewidencji VAT, prywatne na osobnych kartkach dla pracodawcy. */
export function mileageDocument(opts: MileageOptions): TDocumentDefinitions {
  const sheets = opts.sheets.length > 0 ? opts.sheets : [{ vehicle: '', entries: [] }];
  const title = opts.kind === 'sluzbowy' ? 'Ewidencja przebiegu pojazdu dla celów VAT' : 'Ewidencja przejazdów prywatnych';
  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [28, 20, 28, 16],
    info: { title: `${title} ${romanMonth(opts.month)} ${opts.month.slice(0, 4)}`, creator: COMPANY_NAME },
    defaultStyle: { font: 'Roboto', fontSize: 8, color: BLACK, lineHeight: 1.05 },
    content: [
      ...sheets.flatMap((sheet, i) => sheetPages(opts, sheet, i === 0)),
      ...(opts.summary && opts.summary.length > 0 ? [summaryPage(opts.month, opts.summary)] : []),
    ],
  } as TDocumentDefinitions;
}


/**
 * Podsumowanie firmy (panel admina): suma okresu, formy płatności, koszty, kilometry, wynik gotówki i ranking
 * regionów z obrotem, zabiegami, kosztami, kilometrami i wynikiem.
 */
export function companyDocument(
  total: Report,
  ranking: Array<{ name: string; prefix: string; visits: number; report: Report }>,
  periodLabel: string,
): TDocumentDefinitions {
  const summary: Array<[string, string, boolean?]> = [
    ['Obrót', formatPln(total.turnover), true],
    ...PAY_METHODS.map((m): [string, string] => [PAY_NAMES[m], formatPln(total.byMethod[m])]),
    ['Zabiegi wykonane', String(total.visits.length)],
    ['Koszty', formatPln(total.costs)],
    ['Premie', formatPln(total.bonus)],
    ['Km służbowo (VAT)', `${total.km.sluzbowy} km`],
    ['w tym prywatne', `${total.km.prywatny} km`],
    ['Wynik gotówka', formatPln(total.cashForBoss), true],
  ];
  return {
    ...base(`Podsumowanie firmy ${periodLabel}`),
    content: [
      { text: COMPANY_NAME, bold: true, fontSize: 11 },
      { text: 'Podsumowanie firmy', style: 'title', margin: [0, 4, 0, 2] },
      { text: periodLabel, color: MUTED },
      { text: 'Cała firma', style: 'section' },
      {
        layout: tableLayout,
        table: {
          widths: ['*', 110],
          body: summary.map(([label, value, strong]) => [{ text: label, bold: Boolean(strong) }, right(value, { bold: Boolean(strong) })]),
        },
      },
      { text: 'Ranking regionów (obrót)', style: 'section' },
      ranking.length > 0
        ? {
            layout: tableLayout,
            table: {
              headerRows: 1,
              widths: [16, '*', 66, 42, 62, 48, 66],
              body: [
                ['#', 'Region', 'Obrót', 'Zabiegi', 'Koszty', 'Km', 'Wynik gotówka'].map((t, i) => (i >= 2 ? right(t, { style: 'th' }) : { text: t, style: 'th' })),
                ...ranking.map((r, i) => [
                  String(i + 1),
                  r.prefix ? `${r.name} (${r.prefix})` : r.name,
                  right(formatPln(r.report.turnover), { bold: true }),
                  right(String(r.visits)),
                  right(formatPln(r.report.costs + r.report.bonus)),
                  right(String(r.report.km.sluzbowy)),
                  right(formatPln(r.report.cashForBoss)),
                ]),
              ],
            },
          }
        : { text: 'Brak regionów.', color: MUTED },
      { text: `Wygenerowano ${formatDate(new Date().toISOString())}`, style: 'small', margin: [0, 16, 0, 0] },
    ],
  };
}

// ---------- Podsumowanie zlecenia ----------

const VISIT_STATUS: Record<Visit['status'], string> = {
  zaplanowany: 'Zaplanowany',
  w_trakcie: 'W trakcie',
  wykonany: 'Wykonany',
  odwolany: 'Odwołany',
};

/**
 * Podsumowanie jednego zlecenia: klient, adres, co robimy, wszystkie zabiegi (termin, technik, wykonane prace,
 * płatność) i zalecenia z wykonanych zabiegów. Do wysłania klientowi, księgowej albo do akt.
 */
export function orderDocument(order: Order, visits: Visit[], opts: { vatRate: number }): TDocumentDefinitions {
  const code = orderCode(order);
  const info = (rows: Array<[string, string]>): Content => ({
    layout: tableLayout,
    table: { widths: [110, '*'], body: rows.filter(([, v]) => v.trim()).map(([k, v]) => [{ text: k, color: MUTED }, v]) },
  });
  const flatParts = order.building === 'blok'
    ? [order.flatNo.trim() && `mieszkanie ${order.flatNo.trim()}`, order.staircase.trim() && `klatka ${order.staircase.trim()}`, order.floor.trim() && `piętro ${order.floor.trim()}`].filter(Boolean).join(', ')
    : '';
  const price = priceRange({ priceMin: order.priceMin, priceMax: order.priceMax, invoice: order.invoice }, opts.vatRate);
  const sorted = [...visits].sort((a, b) => a.seq - b.seq);
  const paid = sorted.filter((v) => v.status === 'wykonany' && v.amount !== null).reduce((sum, v) => sum + (v.amount ?? 0), 0);
  const when = (v: Visit) => (v.status === 'wykonany' ? formatDate(v.doneOn ?? v.start) : v.start ? formatTerm(v.start) : 'nieumówiony');

  return {
    ...base(`Zlecenie ${code}`),
    content: [
      { text: `Podsumowanie zlecenia ${code}`, style: 'title' },
      { text: `${COMPANY_NAME} · wygenerowano ${formatDate(new Date().toISOString())}`, style: 'small', margin: [0, 2, 0, 8] },
      { text: 'Klient', style: 'section' },
      info([
        ['Imię i nazwisko / firma', order.clientName],
        ['Telefon', order.phones.map((p) => `${p.number}${p.label ? ` (${p.label})` : ''}`).join(', ')],
        ['E-mail', order.email],
        ['Faktura', INVOICES[order.invoice]],
        ['Dane do faktury', order.invoice === 'vat' ? [order.invoiceName ?? '', order.nip && `NIP ${order.nip}`].filter(Boolean).join(', ') : ''],
        ['Protokół', order.protocol ? 'Tak' : 'Nie'],
        ['Adres do faktury', order.invoice !== 'brak' ? order.invoiceAddress : ''],
        ['Przyjął zlecenie', order.ownerName],
        ['Kod pink', order.pink ? order.pinkNote || 'tak' : ''],
      ]),
      { text: 'Adres', style: 'section' },
      info([
        ['Ulica', `${order.street} ${order.houseNo}`.trim()],
        ['Miejscowość', [order.postalCode, order.city].filter(Boolean).join(' ')],
        ['Budynek', BUILDINGS[order.building] ?? ''],
        ['Lokal', flatParts],
        ['Jak dotrzeć', order.access],
      ]),
      { text: 'Zlecenie', style: 'section' },
      info([
        ['Szkodnik', pestName(order)],
        ['Co robimy', methodNames(order).join(', ')],
        ['Opis', order.description],
        ['Metraż', order.areaM2 ? `${order.areaM2} m²` : ''],
        ['Cena', price ? [price.net, price.gross].filter(Boolean).join(' / ') : ''],
      ]),
      { text: 'Zabiegi', style: 'section' },
      {
        layout: tableLayout,
        table: {
          headerRows: 1,
          widths: [52, 62, 60, 70, '*', 70],
          body: [
            [{ text: 'Zabieg', style: 'th' }, { text: 'Stan', style: 'th' }, { text: 'Termin', style: 'th' }, { text: 'Technik', style: 'th' }, { text: 'Wykonano', style: 'th' }, { text: 'Płatność', style: 'th', alignment: 'right' }],
            ...sorted.map((v) => [
              visitCode(order, v.seq),
              VISIT_STATUS[v.status],
              when(v),
              v.technicianName || '—',
              workSummary(v) || '—',
              right(v.amount !== null && v.status === 'wykonany' ? `${formatPln(v.amount)}${v.payMethod ? `\n${PAY_NAMES[v.payMethod]}` : ''}` : '—'),
            ]),
            [{ text: 'Razem zapłacono', bold: true, colSpan: 5 }, '', '', '', '', right(formatPln(paid), { bold: true })],
          ],
        },
      },
      // Szczegóły każdego zabiegu (bez odwołanych): termin, kto umówił, zakres i cena, opis i wywiad, wykonane prace,
      // uszczelnienia, zalecenia i płatność.
      ...sorted
        .filter((v) => v.status !== 'odwolany')
        .flatMap((v): Content[] => {
          const vp = priceRange({ ...visitPrice(v, order), invoice: order.invoice }, opts.vatRate);
          const rows: Array<[string, string]> = [
            ['Stan', VISIT_STATUS[v.status]],
            ['Termin', when(v)],
            ['Czas trwania', v.durationMin ? `${v.durationMin} min` : ''],
            ['Umówione przez', v.bookedByName ?? ''],
            ['Technik', v.status === 'zaplanowany' ? '' : v.technicianName],
            ['Co pryskamy', scopeText(v.scope)],
            ['Cena', vp ? [vp.net, vp.gross].filter(Boolean).join(' / ') : ''],
            ['Wykonano', workSummary(v)],
            ['Do uszczelnienia', (v.sealing ?? []).join(', ')],
            ['Zastano', v.findings],
            ['Problemy', v.problems],
            ['Płatność', v.status === 'wykonany' && v.amount !== null ? `${formatPln(v.amount)}${v.payMethod ? `, ${PAY_NAMES[v.payMethod]}` : ''}` : ''],
          ];
          const interview = interviewLines(v.interview);
          return [
            { text: `Zabieg ${roman(v.seq)} · ${visitCode(order, v.seq)}`, style: 'section' },
            info(rows),
            ...(interview.length ? [{ text: 'Wywiad', bold: true, margin: [0, 6, 0, 2] } as Content, { ul: interview } as Content] : []),
            ...(v.recommendations.length ? [{ text: 'Zalecenia', bold: true, margin: [0, 6, 0, 2] } as Content, { ul: v.recommendations } as Content] : []),
          ];
        }),
    ],
  } as TDocumentDefinitions;
}
