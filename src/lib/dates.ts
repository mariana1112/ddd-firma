// Trzy rodzaje czasu w aplikacji:
// - data: "YYYY-MM-DD", kalendarzowa, bez strefy,
// - termin: "YYYY-MM-DDTHH:mm", czas ścienny w Europe/Warsaw,
// - znacznik: ISO 8601 w UTC, tylko dla metadanych rekordu.
// Daty i terminy nie zależą więc od strefy ustawionej w urządzeniu.

export const TIME_ZONE = 'Europe/Warsaw';

const wallClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Aktualny termin w Warszawie, np. "2026-11-04T09:30". */
export function nowWarsaw(at: Date = new Date()): string {
  const parts = Object.fromEntries(wallClock.formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function todayWarsaw(at: Date = new Date()): string {
  return nowWarsaw(at).slice(0, 10);
}

function utcDate(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 04.11.2026 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** 04.11.2026, 09:30 */
export function formatTerm(term: string | null | undefined): string {
  if (!term) return 'Bez terminu';
  return `${formatDate(term)}, ${term.slice(11, 16)}`;
}

export function formatTime(term: string): string {
  return term.slice(11, 16);
}

const longDate = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** środa, 4 listopada */
export function formatDateLong(date: string): string {
  return longDate.format(utcDate(date));
}

const monthName = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', month: 'long', year: 'numeric' });

/** "2026-11" -> "listopad 2026" */
export function formatMonth(month: string): string {
  return monthName.format(utcDate(`${month}-01`));
}

const instant = new Intl.DateTimeFormat('pl-PL', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Znacznik UTC pokazany w czasie warszawskim. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return '—';
  return instant.format(new Date(iso));
}

export function addDays(date: string, days: number): string {
  const d = utcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Dodaje miesiące; 31.01 + 1 miesiąc daje ostatni dzień lutego. */
export function addMonths(date: string, months: number): string {
  const d = utcDate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(d);
}

/** Dodaje minuty do terminu. Działa na czasie ściennym, więc nie reaguje na zmianę czasu. */
export function addMinutes(term: string, minutes: number): string {
  const [date, time] = term.split('T');
  const [h, m] = time.split(':').map(Number);
  const d = utcDate(date);
  d.setUTCMinutes(h * 60 + m + minutes);
  return d.toISOString().slice(0, 16);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  return addMonths(`${month}-01`, by).slice(0, 7);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return toIsoDate(utcDate(date)) === date;
}
