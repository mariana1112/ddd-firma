import type { Order } from './types';

/** Najdłuższy prefiks regionu, np. „LDZ”, „WAW”. */
export const PREFIX_MAX = 5;

/** Wielkie litery (także polskie), bez cyfr, spacji i znaków, do 5 znaków; cyfry są zarezerwowane dla numeru. */
export function normalizePrefix(value: string): string {
  return value
    .toLocaleUpperCase('pl-PL')
    .replace(/[^A-ZĄĆĘŁŃÓŚŹŻ]/g, '')
    .slice(0, PREFIX_MAX);
}

/** Kod zlecenia: prefiks regionu i czterocyfrowy numer, np. LDZ-0042. Zlecenie bez prefiksu: 0042. */
export function orderCode(order: Pick<Order, 'number'> & { prefix?: string }): string {
  const digits = String(order.number).padStart(4, '0');
  return order.prefix ? `${order.prefix}-${digits}` : digits;
}

const ROMAN: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** 1 → I, 2 → II, 4 → IV. */
export function roman(n: number): string {
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, symbol] of ROMAN) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

/** Kod zabiegu: kod zlecenia z numerem zabiegu, np. LDZ-0042/II. */
export function visitCode(order: Pick<Order, 'number'> & { prefix?: string }, seq: number): string {
  return `${orderCode(order)}/${roman(seq)}`;
}

/**
 * Czy wpisane w wyszukiwarce pasuje do kodu zlecenia: „42”, „0042”, „#42”, „LDZ-0042”, „ldz42”,
 * „LDZ-0042/II”. Prefiks z zapytania musi pasować, cyfry są początkiem numeru.
 */
export function matchesCode(order: Pick<Order, 'number'> & { prefix?: string }, query: string): boolean {
  const q = normalizePrefixQuery(query);
  const m = /^([A-ZĄĆĘŁŃÓŚŹŻ]*)-?(\d+)(?:\/[IVXLCDM]*)?$/.exec(q);
  if (!m) return false;
  const [, prefix, digits] = m;
  if (prefix && !(order.prefix ?? '').startsWith(prefix)) return false;
  const number = String(order.number);
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return number.startsWith(trimmed) || String(order.number).padStart(4, '0').startsWith(digits);
}

function normalizePrefixQuery(query: string): string {
  return query.trim().replace(/^#/, '').replace(/\s+/g, '').toLocaleUpperCase('pl-PL');
}
