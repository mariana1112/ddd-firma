// Propozycje terminów blisko innych zleceń, żeby nie jeździć dwa razy w tygodniu w to samo miejsce.
//
// Położenie liczymy z dokładnością do miejscowości i kodu pocztowego. Do usługi map (OpenStreetMap
// Nominatim) trafia tylko miejscowość z kodem, nigdy ulica, numer domu ani dane klienta (wyjątek: „Jestem na
// miejscu” w nowym zleceniu wysyła na żądanie technika same współrzędne jego pozycji). Wynik jest
// zapamiętywany na urządzeniu, więc każda miejscowość jest sprawdzana raz.
import { addDays, addMinutes, nowWarsaw } from '../lib/dates';
import { normalizeForSearch } from '../lib/validators';
import { db } from './db';
import { DomainError } from './domain';
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
    if (date < today || date > limit) continue;
    const distanceKm = haversineKm(target, point);
    if (distanceKm > MAX_DISTANCE_KM) continue;
    const travelMin = travelMinutes(distanceKm);
    let start = roundUpToQuarter(addMinutes(visit.start, visit.durationMin + travelMin));
    if (start.slice(11) > addMinutes(`${date}T${WORK_END}`, -durationMin).slice(11)) {
      start = addMinutes(visit.start, -(durationMin + travelMin));
      start = addMinutes(start, -(Number(start.slice(14, 16)) % 15));
      if (start.slice(11) < WORK_START) continue;
    }
    // Dziś tylko godziny, które jeszcze nie minęły.
    if (date === today && start.slice(11) < nowWarsaw().slice(11)) continue;
    const suggestion: Suggestion = { start, date, distanceKm, travelMin, near: { order: item.order, visit } };
    const current = best.get(date);
    if (!current || distanceKm < current.distanceKm) best.set(date, suggestion);
  }
  return [...best.values()].sort((a, b) => a.distanceKm - b.distanceKm || a.date.localeCompare(b.date)).slice(0, 5);
}

// ---------- Aktualna pozycja: adres z miejsca, w którym stoi technik ----------

export interface PositionAddress {
  street: string;
  houseNo: string;
  postalCode: string;
  city: string;
  /** Link do Google Maps z dokładnym punktem: „Nawiguj” prowadzi dokładnie tutaj. */
  mapsLink: string;
}

/** Link Google Maps do punktu (rozpoznawany przez pole „Miejsce w Google Maps” i nawigację). */
export const pointMapsLink = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Nominatim „reverse”: pola adresu z odpowiedzi usługi map. */
export function addressFromNominatim(address: Record<string, string | undefined>): Omit<PositionAddress, 'mapsLink'> {
  return {
    street: address.road ?? address.pedestrian ?? address.footway ?? address.square ?? '',
    houseNo: address.house_number ?? '',
    postalCode: address.postcode ?? '',
    city: address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality ?? '',
  };
}

/**
 * Adres z pozycji GPS: tylko na żądanie technika („Użyj mojej pozycji”). Do OpenStreetMap trafiają same
 * współrzędne (bez danych klienta). Bez internetu zostaje sam link do punktu na mapie.
 */
export async function addressAt(point: LatLng): Promise<PositionAddress> {
  const mapsLink = pointMapsLink(point);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { street: '', houseNo: '', postalCode: '', city: '', mapsLink };
  const params = new URLSearchParams({ format: 'jsonv2', lat: String(point.lat), lon: String(point.lng), zoom: '18', addressdetails: '1' });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: { 'Accept-Language': 'pl' } });
    if (!response.ok) return { street: '', houseNo: '', postalCode: '', city: '', mapsLink };
    const json = (await response.json()) as { address?: Record<string, string> };
    return { ...addressFromNominatim(json.address ?? {}), mapsLink };
  } catch {
    return { street: '', houseNo: '', postalCode: '', city: '', mapsLink };
  }
}

/** Pozycja z GPS telefonu (dokładna, do 20 s). Błąd z polskim opisem, gdy brak zgody albo sygnału. */
export function currentPosition(): Promise<LatLng & { accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new DomainError('Ten telefon nie udostępnia lokalizacji.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new DomainError(
            e.code === e.PERMISSION_DENIED
              ? 'Brak zgody na lokalizację. Włącz ją: iPhone → Ustawienia → Prywatność → Usługi lokalizacji → Safari (podczas używania).'
              : e.code === e.TIMEOUT
                ? 'Nie udało się ustalić pozycji (słaby sygnał). Spróbuj przy oknie albo na zewnątrz.'
                : 'Nie udało się ustalić pozycji.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  });
}

// ---------- Plan dnia przy umawianiu: trasa i wolne godziny ----------

export interface DayStop {
  start: string;
  durationMin: number;
  label: string;
  city: string;
  point: LatLng | null;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const roundUp10 = (min: number) => Math.ceil(min / 10) * 10;
/** Dojazd między dwoma miejscami: z odległości, a bez położenia przyjmujemy 30 minut. */
const drive = (a: LatLng | null, b: LatLng | null) => (a && b ? travelMinutes(haversineKm(a, b)) : 30);

/**
 * Wolne godziny w danym dniu na nowy zabieg (co 10 minut): po każdym zabiegu z dojazdem, tak żeby zdążyć na
 * kolejny, w godzinach pracy 8:00–19:00, a dziś nie wcześniej niż teraz. Najwyżej 4 propozycje.
 */
export function freeSlots(stops: DayStop[], target: LatLng | null, durationMin: number, opts: { nowMin?: number } = {}): string[] {
  const dayStart = toMin(WORK_START);
  const dayEnd = toMin(WORK_END);
  const sorted = [...stops].sort((a, b) => a.start.localeCompare(b.start));
  const candidates = [dayStart, ...sorted.map((s) => toMin(s.start.slice(11, 16)) + s.durationMin + drive(s.point, target))];
  const out: string[] = [];
  for (const raw of candidates) {
    const start = roundUp10(Math.max(raw, opts.nowMin !== undefined ? roundUp10(opts.nowMin) : 0));
    const end = start + durationMin;
    if (end > dayEnd) continue;
    const clash = sorted.some((s) => {
      const sStart = toMin(s.start.slice(11, 16));
      const sEnd = sStart + s.durationMin;
      // Nowy zabieg musi skończyć się z zapasem na dojazd do kolejnego i zacząć po dojeździe z poprzedniego.
      return start < sEnd + drive(s.point, target) && end + drive(target, s.point) > sStart;
    });
    const label = toHhmm(start);
    if (!clash && !out.includes(label)) out.push(label);
    if (out.length >= 4) break;
  }
  return out;
}
