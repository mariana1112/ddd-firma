import { normalizeCity } from './cities';
import { visitCode } from './codes';
import { db } from './db';
import { DomainError } from './domain';
import { normalizePlate, routePoints } from './mileage';
import { trips } from './repo';
import type { Order, Trip, Visit } from './types';

/**
 * „Dzień w trasie”: rano technik potwierdza licznik („Jadę”), wieczorem wpisuje jeden stan licznika. Trasa i cel
 * wyjazdu składają się z zabiegów tego dnia, a całość zapisuje się jako jeden przejazd służbowy (wpis ewidencji VAT).
 */
export interface DayStart {
  date: string;
  odometer: number;
  vehicle: string;
  from: string;
  startedAt: string;
  /** Przystanki bez zabiegu (stacja, hurtownia), dopisane w ciągu dnia. */
  stops?: string[];
}

/** Klucz w pamięci tego telefonu (bez synchronizacji): start dnia dotyczy tylko tego urządzenia. */
export const DAY_START_KEY = 'dayStart';

export async function getDayStart(): Promise<DayStart | null> {
  return ((await db.meta.get(DAY_START_KEY))?.value as DayStart | undefined) ?? null;
}

export async function startDay(start: DayStart): Promise<void> {
  await db.meta.put({ key: DAY_START_KEY, value: start, updatedAt: new Date().toISOString() });
}

/** Dopisuje przystanek do trwającego dnia. */
export async function addStop(place: string): Promise<void> {
  const start = await getDayStart();
  const city = normalizeCity(place);
  if (!start || !city) return;
  await startDay({ ...start, stops: [...(start.stops ?? []), city] });
}

export async function clearDayStart(): Promise<void> {
  await db.meta.delete(DAY_START_KEY);
}

/** Zabiegi technika w danym dniu (umówione albo wykonane), po kolei według godzin. */
export function dayVisits(list: Visit[], date: string, me: string | null): Visit[] {
  return list
    .filter((v) => v.status !== 'odwolany' && !v.deletedAt && (v.doneOn === date || v.start?.slice(0, 10) === date))
    .filter((v) => !me || !v.technicianId || v.technicianId === me)
    .sort((a, b) => (a.startedAt ?? a.start ?? '').localeCompare(b.startedAt ?? b.start ?? ''));
}

/** Trasa dnia: start, miejscowości zabiegów i przystanki po kolei, powrót do startu. „Gdańsk – Gdańsk” to jeden Gdańsk. */
export function dayRoute(from: string, visitsOfDay: Visit[], orders: Map<string, Order>, stops: string[] = []): string[] {
  const cities = visitsOfDay.map((v) => orders.get(v.orderId)?.city ?? '').filter(Boolean);
  return routePoints([from, ...cities, ...stops, from]);
}

/** Cel wyjazdu do ewidencji: numery zabiegów dnia. */
export function dayPurpose(visitsOfDay: Visit[], orders: Map<string, Order>): string {
  const codes = visitsOfDay
    .map((v) => {
      const order = orders.get(v.orderId);
      return order ? visitCode(order, v.seq) : '';
    })
    .filter(Boolean);
  return codes.length ? `Zabiegi ${codes.join(', ')}` : 'Wyjazd służbowy';
}

/**
 * Zapis dnia jako jeden przejazd służbowy. Kilometry to różnica liczników; „w tym prywatne” zostaje do wglądu,
 * a do VAT cały dzień jest służbowy.
 */
export async function finishDay(input: {
  start: DayStart;
  odometerEnd: number;
  route: string[];
  purpose: string;
  privateKm: number;
  ownerId: string | null;
  driver: string;
  timeTo: string;
}): Promise<Trip> {
  const { start, route } = input;
  if (!Number.isInteger(input.odometerEnd) || input.odometerEnd < start.odometer) {
    throw new DomainError('Licznik wieczorem nie może być mniejszy niż rano.');
  }
  const km = input.odometerEnd - start.odometer;
  const privateKm = Math.max(0, Math.min(Math.round(input.privateKm || 0), km));
  const trip = await trips.create({
    ownerId: input.ownerId,
    date: start.date,
    kind: 'sluzbowy',
    timeFrom: start.startedAt.slice(11, 16),
    timeTo: input.timeTo,
    from: route[0] ?? normalizeCity(start.from),
    via: route.slice(1, -1).join(', '),
    to: route[route.length - 1] ?? normalizeCity(start.from),
    purpose: input.purpose,
    vehicle: start.vehicle,
    driver: input.driver,
    odometerStart: start.odometer,
    odometerEnd: input.odometerEnd,
    privateKm,
  });
  await clearDayStart();
  return trip;
}

/** Luka w liczniku: stan rano wyższy niż po ostatnim przejeździe tym autem. */
export interface OdometerGap {
  vehicle: string;
  date: string;
  from: number;
  to: number;
  km: number;
}

/** Luki w ciągłości licznika w przejazdach (dla każdego auta osobno), od najstarszych. */
export function odometerGaps(list: Trip[]): OdometerGap[] {
  const byVehicle = new Map<string, Trip[]>();
  for (const t of list) {
    const plate = normalizePlate(t.vehicle) || '—';
    byVehicle.set(plate, [...(byVehicle.get(plate) ?? []), t]);
  }
  const gaps: OdometerGap[] = [];
  for (const [vehicle, group] of byVehicle) {
    const sorted = [...group].sort((a, b) => a.odometerStart - b.odometerStart || a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (next.odometerStart > prev.odometerEnd) {
        gaps.push({ vehicle, date: next.date, from: prev.odometerEnd, to: next.odometerStart, km: next.odometerStart - prev.odometerEnd });
      }
    }
  }
  return gaps.sort((a, b) => a.date.localeCompare(b.date));
}

/** Uzupełnienie luki: przejazd służbowy z ostatniego miejsca do miejsca startu, z brakującymi kilometrami. */
export async function fillGap(gap: OdometerGap, place: string, ownerId: string | null, driver: string): Promise<Trip> {
  const city = normalizeCity(place);
  return trips.create({
    ownerId,
    date: gap.date,
    kind: 'sluzbowy',
    timeFrom: '00:00',
    timeTo: '',
    from: city,
    via: '',
    to: city,
    purpose: 'Uzupełnienie licznika',
    vehicle: gap.vehicle === '—' ? '' : gap.vehicle,
    driver,
    odometerStart: gap.from,
    odometerEnd: gap.to,
  });
}
