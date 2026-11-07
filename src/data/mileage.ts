// Kilometrówka: wpisy ewidencji przebiegu pojazdu wyliczane z przejazdów.
import type { Trip } from './types';

/** Numer rejestracyjny w jednej postaci: wielkie litery, bez spacji, np. „WE1KR10”. */
export function normalizePlate(plate: string | null | undefined): string {
  return (plate ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Miesiąc rzymski, jak w ręcznie wypełnianej ewidencji: „2026-10” → „X”. */
export function romanMonth(month: string): string {
  return ROMAN[Number(month.slice(5, 7)) - 1] ?? '';
}

export const tripKm = (t: Pick<Trip, 'odometerStart' | 'odometerEnd'>) => Math.max(0, t.odometerEnd - t.odometerStart);

const viaPoints = (via: string | undefined) =>
  (via ?? '')
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Trasa „Łódź - Kutno - Łódź”. Jazda w obrębie jednej miejscowości to sama nazwa, np. „Łódź”. */
export function routeText(points: string[]): string {
  const out: string[] = [];
  for (const raw of points) {
    const point = raw.trim();
    if (point && point.toLowerCase() !== out.at(-1)?.toLowerCase()) out.push(point);
  }
  return out.join(' - ');
}

export interface MileageEntry {
  date: string;
  route: string;
  km: number;
  driver: string;
  driverKey: string;
  vehicle: string;
  odometerStart: number;
  odometerEnd: number;
}

const driverKey = (t: Trip) => t.ownerId ?? `name:${t.driver ?? ''}`;

/**
 * Wpisy ewidencji z przejazdów jednego rodzaju. Przejazdy z tego samego dnia, auta i kierowcy,
 * po sobie bez przerwy w liczniku, łączą się w jeden wpis z całą trasą dnia, tak jak w ręcznej
 * ewidencji. Przerwa w liczniku (np. prywatna jazda między nimi) zaczyna nowy wpis.
 */
export function mileageEntries(trips: Trip[], driverName: (t: Trip) => string): MileageEntry[] {
  const sorted = [...trips].sort(
    (a, b) => a.date.localeCompare(b.date) || a.odometerStart - b.odometerStart || a.timeFrom.localeCompare(b.timeFrom),
  );
  const entries: Array<MileageEntry & { points: string[] }> = [];
  for (const t of sorted) {
    const last = entries.at(-1);
    const vehicle = normalizePlate(t.vehicle);
    const points = [t.from, ...viaPoints(t.via), t.to];
    if (
      last &&
      last.date === t.date &&
      last.vehicle === vehicle &&
      last.driverKey === driverKey(t) &&
      last.odometerEnd === t.odometerStart
    ) {
      last.points.push(...points);
      last.km += tripKm(t);
      last.odometerEnd = t.odometerEnd;
      continue;
    }
    entries.push({
      date: t.date,
      route: '',
      points,
      km: tripKm(t),
      driver: driverName(t),
      driverKey: driverKey(t),
      vehicle,
      odometerStart: t.odometerStart,
      odometerEnd: t.odometerEnd,
    });
  }
  return entries.map(({ points, ...e }) => ({ ...e, route: routeText(points) }));
}

/** Przejazdy według auta, w kolejności numerów. Przejazdy bez numeru trafiają do grupy „”. */
export function byVehicle(trips: Trip[]): Array<{ vehicle: string; trips: Trip[] }> {
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    const key = normalizePlate(t.vehicle);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([vehicle, list]) => ({ vehicle, trips: list }));
}

export interface DriverSummary {
  driver: string;
  vehicles: string[];
  sluzbowy: number;
  prywatny: number;
}

/** Kto ile przejechał służbowo i prywatnie: zestawienie dla pracodawcy. */
export function driverSummary(trips: Trip[], driverName: (t: Trip) => string): DriverSummary[] {
  const out = new Map<string, DriverSummary>();
  for (const t of trips) {
    const key = driverKey(t);
    const row = out.get(key) ?? { driver: driverName(t), vehicles: [], sluzbowy: 0, prywatny: 0 };
    row[t.kind] += tripKm(t);
    const plate = normalizePlate(t.vehicle);
    if (plate && !row.vehicles.includes(plate)) row.vehicles.push(plate);
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => a.driver.localeCompare(b.driver, 'pl'));
}

/** Arkusze kilometrówki: osobny formularz dla każdego auta, z przejazdów danego rodzaju i miesiąca. */
export function mileageSheets(
  trips: Trip[],
  kind: Trip['kind'],
  month: string,
  driverName: (t: Trip) => string,
): Array<{ vehicle: string; entries: MileageEntry[] }> {
  const chosen = trips.filter((t) => t.kind === kind && t.date.startsWith(`${month}-`));
  return byVehicle(chosen).map((g) => ({ vehicle: g.vehicle, entries: mileageEntries(g.trips, driverName) }));
}

/** Liczba wpisów na stronie formularza: pierwsza ma nagłówek z danymi podatnika. */
export const FIRST_PAGE_ROWS = 17;
export const NEXT_PAGE_ROWS = 23;

/** Podział wpisów na strony formularza. Zawsze co najmniej jedna strona, choćby pusta. */
export function paginate<T>(rows: T[]): T[][] {
  const pages: T[][] = [rows.slice(0, FIRST_PAGE_ROWS)];
  for (let i = FIRST_PAGE_ROWS; i < rows.length; i += NEXT_PAGE_ROWS) pages.push(rows.slice(i, i + NEXT_PAGE_ROWS));
  return pages;
}
