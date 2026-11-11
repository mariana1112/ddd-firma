// Teksty wysyłane klientowi i centrali. Czyste funkcje, więc łatwe do sprawdzenia w testach.
import { methodOf } from './methods';
import { withCountryCode } from '../lib/validators';
import { formatDate, formatTerm, formatTime } from '../lib/dates';
import { roman, visitCode } from './codes';
import { normalizeInterview } from './interview';
import type { AppSettings } from './settings';
import type { BuildingType, InvoiceType, Order, PayMethod, PestCategory, Visit } from './types';

export const BUILDINGS: Record<BuildingType, string> = {
  dom: 'Dom jednorodzinny',
  blizniak: 'Bliźniak',
  blok: 'Blok',
};

export const PESTS: Record<PestCategory, string> = {
  karaluchy: 'Karaluchy',
  chrzaszczowate: 'Chrząszczowate',
  pluskwy: 'Pluskwy',
  gryzonie: 'Gryzonie',
  inne: 'Inne',
};

export const INVOICES: Record<InvoiceType, string> = {
  brak: 'Bez faktury',
  imienna: 'Faktura imienna',
  vat: 'Faktura VAT',
};

export const PAY_NAMES: Record<PayMethod, string> = {
  gotowka: 'Gotówka',
  blik: 'BLIK',
  przelew: 'Przelew',
};

export function pestName(order: Pick<Order, 'pest' | 'pestOther'>): string {
  return order.pest === 'inne' && order.pestOther.trim() ? order.pestOther.trim() : PESTS[order.pest];
}

/** Adres do nawigacji i wiadomości: ulica z numerem i lokalem, miejscowość. */
export function orderAddress(order: Pick<Order, 'street' | 'houseNo' | 'flatNo' | 'building' | 'city'>): string {
  const flat = order.building === 'blok' && order.flatNo.trim() ? `/${order.flatNo.trim()}` : '';
  const street = `${order.street.trim()} ${order.houseNo.trim()}${flat}`.trim();
  return [street, order.city.trim()].filter(Boolean).join(', ');
}

/** Szczegóły dojścia w bloku: klatka i piętro. */
export function accessDetails(order: Pick<Order, 'building' | 'staircase' | 'floor'>): string {
  if (order.building !== 'blok') return '';
  return [order.staircase.trim() && `klatka ${order.staircase.trim()}`, order.floor.trim() && `piętro ${order.floor.trim()}`]
    .filter(Boolean)
    .join(', ');
}

export function mapsUrl(order: Pick<Order, 'street' | 'houseNo' | 'flatNo' | 'building' | 'city' | 'postalCode'>): string {
  const destination = [`${order.street} ${order.houseNo}`.trim(), `${order.postalCode} ${order.city}`.trim()].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/** Link do aplikacji Wiadomości z gotową treścią. */
export function smsUrl(phone: string, body: string): string {
  return `sms:${withCountryCode(phone).replace(/[^\d+]/g, '')}&body=${encodeURIComponent(body)}`;
}

export function telUrl(phone: string): string {
  return `tel:${withCountryCode(phone).replace(/[^\d+]/g, '')}`;
}

const zl = (grosze: number) =>
  new Intl.NumberFormat('pl-PL', { useGrouping: 'always', maximumFractionDigits: 2 }).format(grosze / 100).replace(/ /g, ' ');

/** Widełki: "100–150 zł", a przy fakturze VAT dodatkowo kwoty brutto. */
export function priceRange(order: Pick<Order, 'priceMin' | 'priceMax' | 'invoice'>, vatRate: number): { net: string; gross: string | null } | null {
  const { priceMin, priceMax } = order;
  if (priceMin === null && priceMax === null) return null;
  const range = (a: number | null, b: number | null) =>
    a !== null && b !== null && a !== b ? `${zl(a)}–${zl(b)} zł` : `${zl((a ?? b)!)} zł`;
  const gross = (v: number | null) => (v === null ? null : Math.round((v * (100 + vatRate)) / 100));
  return {
    net: `${range(priceMin, priceMax)}${order.invoice === 'vat' ? ' netto' : ''}`,
    gross: order.invoice === 'vat' ? `${range(gross(priceMin), gross(priceMax))} brutto` : null,
  };
}

/** "Oprysk ciśnieniowy (listwy, kratka, łóżka), Żel" */
export function workSummary(visit: Pick<Visit, 'treatments' | 'places'>): string {
  if (visit.treatments.length === 0) return visit.places.join(', ');
  const places = visit.places.length ? ` (${visit.places.join(', ')})` : '';
  return `${visit.treatments[0]}${places}${visit.treatments.length > 1 ? `, ${visit.treatments.slice(1).join(', ')}` : ''}`;
}

const warsawClock = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
const warsawDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Dzień (RRRR-MM-DD) chwili zapisu w czasie polskim. */
export const dayInWarsaw = (iso: string) => warsawDay.format(new Date(iso));

/** Godzina chwili zapisu w czasie polskim, „14:05”. */
export const clockInWarsaw = (iso: string) => warsawClock.format(new Date(iso));

/**
 * Godziny pracy przy zabiegu: „10:05–11:20”, a gdy zabieg przeszedł przez północ, z datami obu dni
 * („10.11.2026 22:41 – 11.11.2026 11:52”), żeby koniec nie wyglądał na wcześniejszy niż początek.
 */
export function workHours(visit: Pick<Visit, 'startedAt' | 'finishedAt'>): { text: string; multiDay: boolean } {
  const { startedAt, finishedAt } = visit;
  if (startedAt && finishedAt && dayInWarsaw(startedAt) !== dayInWarsaw(finishedAt)) {
    return {
      text: `${formatDate(dayInWarsaw(startedAt))} ${clockInWarsaw(startedAt)} – ${formatDate(dayInWarsaw(finishedAt))} ${clockInWarsaw(finishedAt)}`,
      multiDay: true,
    };
  }
  return { text: [startedAt, finishedAt].filter((t): t is string => Boolean(t)).map(clockInWarsaw).join('–'), multiDay: false };
}

/** Najdłuższy wiarygodny zabieg. Dłużej znaczy, że „Rozpocznij” kliknięto dużo wcześniej (zapomniany zabieg). */
export const MAX_VISIT_HOURS = 8;

/** Początek zabiegu do zapisu przy zakończeniu: zapomniane „Rozpocznij” sprzed ponad 8 godzin nie fałszuje godzin. */
export function startToSave(startedAt: string | null, finishedAt: string): string {
  if (!startedAt) return finishedAt;
  const hours = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 3_600_000;
  return hours > MAX_VISIT_HOURS || hours < 0 ? finishedAt : startedAt;
}

/**
 * Kto umówił zabieg: zapisany przy umawianiu, a w starszych zabiegach pierwszy zabieg umówił ten, kto przyjął zlecenie.
 * Pusty, gdy nie wiadomo (stary zabieg II, III bez tej informacji) albo termin nie jest jeszcze umówiony.
 */
export function bookedBy(visit: Pick<Visit, 'bookedByName' | 'seq' | 'start'>, order: Pick<Order, 'ownerName'>): string {
  if (visit.bookedByName) return visit.bookedByName;
  return visit.seq === 1 && visit.start ? order.ownerName || '' : '';
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function reminderSms(order: Order, visit: Visit, settings: AppSettings): string {
  const text = fill(settings.reminderTemplate, {
    data: formatDate(visit.start),
    godzina: visit.start ? formatTime(visit.start) : '',
    adres: orderAddress(order),
    numer: visitCode(order, visit.seq),
  });
  return text;
}

/**
 * Wiadomość po zabiegu: wykonane czynności, zalecenia i termin kolejnego zabiegu.
 * Termin dopisujemy, gdy kolejny zabieg jest umówiony na konkretny dzień.
 */
/** „a, b oraz c”. */
export function joinPl(items: string[]): string {
  const list = items.map((x) => x.trim()).filter(Boolean);
  return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} oraz ${list[list.length - 1]}`;
}

/**
 * Wykonane prace do podsumowania: oprysk i żel z miejscami („Oprysk ciśnieniowy (listwy, łóżka oraz szafki).”),
 * zamgławianie z zakresem („Zamgławianie ULV całego lokalu.”), pozostałe zabiegi po nazwie.
 */
export function workLines(visit: Pick<Visit, 'treatments' | 'places' | 'scope'>): string[] {
  const places = joinPl(visit.places);
  const scope = visit.scope ?? { kind: 'calosc', note: '' };
  const where = scope.kind === 'calosc' ? 'całego lokalu' : `(${scope.note.trim() || (scope.kind === 'pokoj' ? 'pokój' : 'wybrane miejsca')})`;
  let placesUsed = false;
  const lines = visit.treatments.map((name) => {
    const method = methodOf(name);
    if (method === 'oprysk' || method === 'zelowanie') {
      placesUsed = true;
      const label = method === 'oprysk' ? 'Oprysk ciśnieniowy' : 'Żelowanie';
      return places ? `${label} (${places}).` : `${label}.`;
    }
    if (method === 'ulv') return `Zamgławianie ULV ${where}.`;
    if (method === 'zamglawianie') return `Zamgławianie ${where}.`;
    if (method === 'odplywy') return 'Zalanie odpływów.';
    return `${name.trim()}.`;
  });
  // Miejsca bez oprysku i żelu dopisujemy do pierwszej pracy.
  if (places && !placesUsed && lines.length) lines[0] = `${lines[0].slice(0, -1)} (${places}).`;
  return lines;
}

/**
 * SMS po zabiegu w formacie firmy: wstęp, wykonane prace, zalecenia (z uszczelnieniem i obserwacją), termin
 * kolejnego zabiegu, kontakt i podpis technika ze stroną firmy.
 */
export function finishSms(visit: Visit, next: Visit | null, settings: AppSettings, technician = ''): string {
  const bullet = (text: string) => ` * ${text}`;
  const lines = [settings.summaryIntro, ''];
  const work = workLines(visit);
  if (work.length) lines.push('Wykonane prace:', ...work.map(bullet), '');
  const recs = [...visit.recommendations];
  if (visit.sealing?.length) recs.push(`Uszczelnienie: ${joinPl(visit.sealing)} w celu zablokowania drogi potencjalnej migracji ze szczelin lub podłogi.`);
  if (settings.observationTemplate.trim()) recs.push(fill(settings.observationTemplate.trim(), { numer: settings.reportPhone }));
  lines.push('Zalecenia po zabiegu:', ...recs.map(bullet), '');
  if (next?.start) {
    const ordinal = next.seq === 2 ? 'Drugi' : next.seq === 3 ? 'Trzeci' : `Kolejny (${next.seq})`;
    lines.push(`${ordinal} zabieg: ${formatTerm(next.start).replace(', ', ' o ')}.`, '');
  } else if (next) {
    lines.push('Termin kolejnego zabiegu ustalimy telefonicznie.', '');
  }
  if (settings.contactTemplate.trim()) lines.push(fill(settings.contactTemplate.trim(), { numer: settings.reportPhone }), '');
  lines.push(settings.closing.trim() || 'Pozdrawiam,', technician.trim() || 'Pogromcy Insektów');
  if (settings.website.trim()) lines.push(settings.website.trim());
  return lines.join('\n');
}

/** Wywiad jako wiersze „etykieta: wartość”, tylko z odpowiedziami, które technik zapisał. */
export function interviewLines(raw: Visit['interview']): string[] {
  const i = normalizeInterview(raw);
  const lines: string[] = [];
  if (i.situation) lines.push(`Opis sytuacji: ${i.situation.replace(/\n+/g, '; ')}`);
  if (i.bites) lines.push(`Ugryzienia: ${i.bites}`);
  if (i.seen) lines.push(`Widziane owady: ${i.seen}${i.seen === 'tak' && i.seenCount ? `, ile: ${i.seenCount}` : ''}`);
  if (i.selfTreatment) lines.push(`Środki na własną rękę: ${i.selfTreatment}`);
  if (i.other.trim()) lines.push(`Inne uwagi: ${i.other.trim()}`);
  return lines;
}

/** Podpowiedź w opisie kodu pink. */
export const PINK_PLACEHOLDER = 'Opisz, co się dzieje i jak postępować, np. agresywny pies, klient nie otwiera bez telefonu';

/** Dane zabiegu dla centrali, która przygotowuje protokół. */
export function centralExport(order: Order, visit: Visit, all: Visit[]): string {
  const total = Math.max(all.length, visit.seq);
  const access = accessDetails(order);
  const lines = [
    `Zlecenie ${visitCode(order, visit.seq)}, zabieg ${roman(visit.seq)} z ${total}`,
    `Data: ${workHours(visit).multiDay ? workHours(visit).text : [formatDate(visit.doneOn ?? visit.start), workHours(visit).text].filter(Boolean).join(', ')}`,
    visit.technicianName && `Technik: ${visit.technicianName}`,
    `Adres: ${orderAddress(order)}${order.postalCode ? ` (${order.postalCode})` : ''}, ${BUILDINGS[order.building].toLowerCase()}${access ? `, ${access}` : ''}`,
    `Klient: ${order.clientName}${order.phones[0] ? `, tel. ${order.phones[0].number}` : ''}${order.email ? `, ${order.email}` : ''}`,
    order.areaM2 ? `Metraż: ${order.areaM2} m²` : '',
    `Szkodnik: ${pestName(order)}`,
    `Wykonano: ${workSummary(visit) || '—'}`,
    // Zabiegi sprzed usunięcia tych pól mogą je mieć wypełnione.
    visit.findings.trim() && `Co zastałem: ${visit.findings.trim()}`,
    visit.problems.trim() && `Problemy: ${visit.problems.trim()}`,
  ];
  const interview = interviewLines(visit.interview);
  if (interview.length) lines.push('Wywiad:', ...interview.map((l) => `- ${l}`));
  if (visit.recommendations.length) lines.push('Zalecenia:', ...visit.recommendations.map((r) => `- ${r}`));
  const pay = visit.amount ? `${zl(visit.amount)} zł, ${visit.payMethod ? PAY_NAMES[visit.payMethod] : 'forma nieznana'}` : 'brak';
  lines.push(`Płatność: ${pay}, ${INVOICES[order.invoice].replace(/^\S/, (c) => c.toLowerCase())}${order.invoice !== 'brak' && order.nip ? ` (NIP ${order.nip})` : ''}`);
  const next = all.find((v) => v.seq === visit.seq + 1 && v.status !== 'odwolany');
  if (next) lines.push(`Kolejny zabieg: ${next.start ? formatTerm(next.start) : 'technik umówi z klientem'}`);
  if (order.pink) lines.push(`KOD PINK${order.pinkNote ? `: ${order.pinkNote}` : ''}`);
  return lines.filter(Boolean).join('\n');
}
