// Propozycje terminów blisko innych zleceń, żeby nie jeździć dwa razy w tygodniu w to samo miejsce.
//
// Położenie liczymy z dokładnością do miejscowości i kodu pocztowego. Do usługi map (OpenStreetMap
// Nominatim) trafia tylko miejscowość z kodem, nigdy ulica, numer domu ani dane klienta. Wynik jest
// zapamiętywany na urządzeniu, więc każda miejscowość jest sprawdzana raz.
import { addDays, addMinutes } from '../lib/dates';
import { normalizeForSearch } from '../lib/validators';
import { db } from './db';
import type { Order, Visit } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Szacowany czas przejazdu: drogi są ok. 30% dłuższe niż linia prosta, średnio 45 km/h. */
export function travelMinutes(km: number): number {
  return Math.max(10, Math.round(((km * 1.3) / 45) * 60));
}

const geoKey = (city: string, postalCode: string) => `geo:${normalizeForSearch(`${postalCode.trim()} ${city.trim()}`)}`;

/** Współrzędne miejscowości z pamięci urządzenia albo z Nominatim. Null, gdy nie da się ustalić. */
export async function locate(city: string, postalCode: string): Promise<LatLng | null> {
  if (!city.trim()) return null;
  const key = geoKey(city, postalCode);
  const cached = (await db.meta.get(key))?.value as LatLng | null | undefined;
  if (cached !== undefined) return cached;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'pl', city: city.trim() });
  if (postalCode.trim()) params.set('postalcode', postalCode.trim());
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'Accept-Language': 'pl' } });
    if (!response.ok) return null;
    const [hit] = (await response.json()) as Array<{ lat: string; lon: string }>;
    const point = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
    await db.meta.put({ key, value: point, updatedAt: new Date().toISOString() });
    return point;
  } catch {
    return null;
  }
}

export interface Suggestion {
  start: string;
  date: string;
  distanceKm: number;
  travelMin: number;
  near: { order: Order; visit: Visit };
}

const WORK_START = '08:00';
const WORK_END = '19:00';
const MAX_DISTANCE_KM = 25;

function roundUpToQuarter(term: string): string {
  const minutes = Number(term.slice(14, 16));
  const extra = (15 - (minutes % 15)) % 15;
  return addMinutes(term, extra);
}

/**
 * Dni w najbliższych dwóch tygodniach, w które jest już zabieg w pobliżu. Proponowana godzina to
 * koniec tamtego zabiegu plus dojazd, a gdy to za późno, czas przed nim.
 */
export function suggestSlots(
  target: LatLng,
  durationMin: number,
  today: string,
  planned: Array<{ order: Order; visit: Visit; point: LatLng | null }>,
): Suggestion[] {
  const limit = addDays(today, 14);
  const best = new Map<string, Suggestion>();
  for (const item of planned) {
    const { visit, point } = item;
    if (!point || !visit.start || visit.status !== 'zaplanowany') continue;
    const date = visit.start.slice(0, 10);
    if (date <= today || date > limit) continue;
    const distanceKm = haversineKm(target, point);
    if (distanceKm > MAX_DISTANCE_KM) continue;
    const travelMin = travelMinutes(distanceKm);
    let start = roundUpToQuarter(addMinutes(visit.start, visit.durationMin + travelMin));
    if (start.slice(11) > addMinutes(`${date}T${WORK_END}`, -durationMin).slice(11)) {
      start = addMinutes(visit.start, -(durationMin + travelMin));
      start = addMinutes(start, -(Number(start.slice(14, 16)) % 15));
      if (start.slice(11) < WORK_START) continue;
    }
    const suggestion: Suggestion = { start, date, distanceKm, travelMin, near: { order: item.order, visit } };
    const current = best.get(date);
    if (!current || distanceKm < current.distanceKm) best.set(date, suggestion);
  }
  return [...best.values()].sort((a, b) => a.distanceKm - b.distanceKm || a.date.localeCompare(b.date)).slice(0, 5);
}
