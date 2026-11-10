// Teksty wysyłane klientowi i centrali. Czyste funkcje, więc łatwe do sprawdzenia w testach.
import { ULV_NOTICE } from './methods';
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
  return `sms:${phone.replace(/[^\d+]/g, '')}&body=${encodeURIComponent(body)}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
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

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function reminderSms(order: Order, visit: Visit, settings: AppSettings): string {
  const text = fill(settings.reminderTemplate, {
    data: formatDate(visit.start),
    godzina: visit.start ? formatTime(visit.start) : '',
    adres: orderAddress(order),
    numer: visitCode(order, visit.seq),
  });
  // Klient musi się przygotować do zamgławiania: wyjść z lokalu i potem posprzątać.
  return order.methods?.includes('ulv') ? `${text}\n${ULV_NOTICE}` : text;
}

/**
 * Wiadomość po zabiegu: wykonane czynności, zalecenia i termin kolejnego zabiegu.
 * Termin dopisujemy, gdy kolejny zabieg jest umówiony na konkretny dzień.
 */
export function finishSms(visit: Visit, next: Visit | null, settings: AppSettings): string {
  const lines = [settings.finishGreeting];
  const work = workSummary(visit);
  if (work) lines.push(`Wykonano: ${work}.`);
  if (visit.recommendations.length) {
    lines.push('Zalecenia:');
    for (const r of visit.recommendations) lines.push(`- ${r}`);
  }
  if (next?.start) {
    const ordinal = next.seq === 2 ? 'Drugi' : next.seq === 3 ? 'Trzeci' : `Kolejny (${next.seq})`;
    lines.push(`${ordinal} zabieg: ${formatTerm(next.start).replace(', ', ' o ')}.`);
  } else if (next) {
    lines.push('Termin kolejnego zabiegu ustalimy telefonicznie.');
  }
  lines.push('Pozdrawiamy, Pogromcy Insektów');
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
    `Data: ${formatDate(visit.doneOn ?? visit.start)}${visit.startedAt ? `, ${new Date(visit.startedAt).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })}` : ''}${visit.finishedAt ? `–${new Date(visit.finishedAt).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })}` : ''}`,
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
