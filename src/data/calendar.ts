import { roman, visitCode } from './codes';
import { invoiceHolder } from './invoice';
import { mainPhone } from './order-search';
import { pestName } from './texts';
import type { Order, Visit } from './types';
import { visitPrice } from './visit-terms';
import { addMinutes } from '../lib/dates';

/** „2026-11-10T10:00” → „20261110T100000” (czas lokalny; strefę podaje parametr ctz). */
const stamp = (term: string) => `${term.slice(0, 10).replace(/-/g, '')}T${term.slice(11, 16).replace(':', '')}00`;

const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

/** Złote bez groszy, gdy są pełne: 60000 → „600”, 45050 → „450,50”. */
const zl = (grosze: number) => (grosze % 100 ? (grosze / 100).toFixed(2).replace('.', ',') : String(grosze / 100));

/** Cena w tytule: „600” albo „300-450”, przy fakturze VAT z dopiskiem „Netto”. */
function priceText(order: Order, visit: Pick<Visit, 'priceMin' | 'priceMax'>): string {
  const { priceMin, priceMax } = visitPrice(visit as Visit, order);
  const parts = [priceMin, priceMax].filter((p): p is number => p != null);
  if (parts.length === 0) return '';
  const text = parts.length === 2 && parts[0] !== parts[1] ? `${zl(parts[0])}-${zl(parts[1])}` : zl(parts[0]);
  return order.invoice === 'vat' ? `${text} Netto` : text;
}

/** Zakres w tytule: „full” dla całego mieszkania, inaczej pokój albo opis. */
function scopeShort(visit: Pick<Visit, 'scope'>): string {
  const scope = visit.scope ?? { kind: 'calosc', note: '' };
  if (scope.kind === 'calosc') return 'full';
  return scope.note.trim() || (scope.kind === 'pokoj' ? 'pokój' : 'inne');
}

/**
 * Wpis do Kalendarza Google w formacie, którego firma używała dotąd:
 * - tytuł: „II pluskwy 600 Netto full, +48 573 324 034” (zabieg, szkodnik, cena, zakres, telefon; bez kwoty pobranej),
 * - miejsce: „Zakopiańska 18, 80-142 Gdańsk, Polska”,
 * - opis: mieszkanie i telefon, adres z numerem lokalu, dzień i godzina, dane do faktury, opis zlecenia i jego kod.
 */
export function googleCalendarUrl(order: Order, visit: Pick<Visit, 'seq' | 'start' | 'durationMin' | 'scope' | 'priceMin' | 'priceMax'>): string | null {
  if (!visit.start) return null;
  const end = addMinutes(visit.start, visit.durationMin || 60);
  const phone = mainPhone(order);
  const flat = order.building === 'blok' ? order.flatNo.trim() : '';
  const street = `${order.street.trim()} ${order.houseNo.trim()}`.trim();
  const title = [roman(visit.seq), pestName(order).toLowerCase(), priceText(order, visit), scopeShort(visit)].filter(Boolean).join(' ');
  const [y, m, d] = visit.start.slice(0, 10).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const time = `${Number(visit.start.slice(11, 13))}.${visit.start.slice(14, 16)}`;

  const details: string[] = [];
  details.push([flat && `Mieszkania ${flat}`, phone].filter(Boolean).join(' , '));
  details.push(`${street}${flat ? `/${flat}` : ''}`);
  details.push(`${weekday} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`, time);
  if (order.invoice !== 'brak') {
    details.push('', 'Dane do faktury');
    if (order.invoice === 'vat' && order.nip.trim()) details.push(`NIP:${order.nip.replace(/\D/g, '')}`);
    details.push(invoiceHolder(order));
    if (order.invoiceAddress.trim()) details.push(order.invoiceAddress.trim());
    if (order.email.trim()) details.push(order.email.trim());
  }
  if (order.description.trim()) details.push('', `Opis: ${order.description.trim()}`);
  if (order.access.trim()) details.push('', `Dojazd: ${order.access.trim()}`);
  details.push('', `Zlecenie ${visitCode(order, visit.seq)}`);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: phone ? `${title}, ${phone}` : title,
    dates: `${stamp(visit.start)}/${stamp(end)}`,
    ctz: 'Europe/Warsaw',
    location: [street, [order.postalCode.trim(), order.city.trim()].filter(Boolean).join(' '), 'Polska'].filter(Boolean).join(', '),
    details: details.join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
