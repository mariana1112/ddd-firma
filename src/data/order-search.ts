import { matchesCode, orderCode } from './codes';
import { orderAddress, pestName } from './texts';
import type { Order } from './types';
import { normalizeForSearch } from '../lib/validators';

/**
 * Cyfry numeru telefonu bez kierunkowego Polski: „+48 500 600 700”, „0048500600700” i „500-600-700” dają
 * „500600700”, więc numer podany przez dzwoniącego znajduje się niezależnie od zapisu.
 */
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length > 9 && digits.startsWith('0048')) return digits.slice(4);
  if (digits.length > 9 && digits.startsWith('48')) return digits.slice(2);
  return digits;
}

/** Zapytanie wygląda jak numer (lub jego fragment): same cyfry i znaki telefonu, co najmniej 3 cyfry. */
export function looksLikePhone(query: string): boolean {
  return /^[\d\s+()-]+$/.test(query.trim()) && query.replace(/\D/g, '').length >= 3;
}

/** Pierwszy numer zlecenia do wyświetlenia na liście i w kalendarzu. */
export function mainPhone(order: Pick<Order, 'phones'>): string {
  return order.phones.find((p) => p.number.trim())?.number.trim() ?? '';
}

/**
 * Czy zlecenie pasuje do wyszukiwania: kod („0042”, „LDZ-0042/II”), numer telefonu w dowolnym zapisie albo słowa
 * z nazwiska, adresu, kodu pocztowego i szkodnika.
 */
export function orderMatches(order: Order, query: string): boolean {
  const q = normalizeForSearch(query.trim().replace(/^#/, ''));
  if (!q) return true;
  if (matchesCode(order, query)) return true;
  if (looksLikePhone(query)) {
    const wanted = phoneDigits(query);
    if (order.phones.some((p) => phoneDigits(p.number).includes(wanted))) return true;
  }
  const hay = normalizeForSearch(
    [orderCode(order), order.clientName, orderAddress(order), order.postalCode, pestName(order), ...order.phones.map((p) => p.number.replace(/\s/g, ''))].join(' '),
  );
  return q.split(/\s+/).every((word) => hay.includes(word));
}
