// Propozycje terminów blisko innych zleceń, żeby nie jeździć dwa razy w tygodniu w to samo miejsce.
//
// Położenie zlecenia: punkt z zapisanego linku Google Maps (bez pytania usługi map), a bez niego ulica z kodem
// i miejscowością (w Gdańsku Przymorze i Morena to różne miejsca). Do usługi map (OpenStreetMap Nominatim) trafia
// tylko nazwa ulicy, kod i miejscowość: nigdy numer domu ani dane klienta (wyjątek: „Jestem na miejscu” w nowym
// zleceniu wysyła na żądanie technika same współrzędne jego pozycji). Gdy ulicy nie da się znaleźć, liczy się
// miejscowość. Wynik jest zapamiętywany na urządzeniu, więc każda ulica jest sprawdzana raz.
import { addDays, nowWarsaw } from '../lib/dates';
import { normalizeForSearch } from '../lib/validators';
import { db } from './db';
import { coordsFromLink } from './maps';
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

// Nominatim pozwala na jedno zapytanie na sekundę: kolejne czekają w kolejce.
let gate: Promise<unknown> = Promise.resolve();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = gate.then(job);
  gate = run.then(
    () => pause(1100),
    () => pause(1100),
  );
  return run;
}

/** Zapytanie do Nominatim z pamięcią na urządzeniu (także brak wyniku). Null, gdy nie da się ustalić. */
async function lookup(key: string, query: Record<string, string>): Promise<LatLng | null> {
  const cached = (await db.meta.get(key))?.value as LatLng | null | undefined;
  if (cached !== undefined) return cached;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'pl', ...query });
  try {
    const response = await queued(() => fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'Accept-Language': 'pl' } }));
    if (!response.ok) return null;
    const [hit] = (await response.json()) as Array<{ lat: string; lon: string }>;
    const point = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
    await db.meta.put({ key, value: point, updatedAt: new Date().toISOString() });
    return point;
  } catch {
    return null;
  }
}

/** Współrzędne miejscowości z pamięci urządzenia albo z Nominatim. Null, gdy nie da się ustalić. */
export async function locate(city: string, postalCode: string): Promise<LatLng | null> {
  if (!city.trim()) return null;
  return lookup(geoKey(city, postalCode), { city: city.trim(), ...(postalCode.trim() ? { postalcode: postalCode.trim() } : {}) });
}

/** Nazwa ulicy bez „ul.” i bez numeru domu (numer nie trafia do usługi map). */
export function streetName(street: string): string {
  return street
    .replace(/^\s*(ul\.?|ulica)\s+/i, '')
    .replace(/\s+\d+[a-z]?([/-]\d+[a-z]?)?\s*$/i, '')
    .trim();
}

export interface Place {
  street?: string;
  city: string;
  postalCode: string;
  mapsLink?: string;
}

/**
 * Położenie miejsca zlecenia: punkt z linku Google Maps, a bez niego ulica (bez numeru) z kodem i miejscowością.
 * Gdy ulicy nie ma albo nie da się jej znaleźć: środek miejscowości.
 */
export async function locatePlace(place: Place): Promise<LatLng | null> {
  const pin = coordsFromLink(place.mapsLink);
  if (pin) return pin;
  const street = streetName(place.street ?? '');
  if (street && place.city.trim()) {
    const point = await lookup(`${geoKey(place.city, place.postalCode)}|${normalizeForSearch(street)}`, {
      street,
      city: place.city.trim(),
      ...(place.postalCode.trim() ? { postalcode: place.postalCode.trim() } : {}),
    });
    if (point) return point;
  }
  return locate(place.city, place.postalCode);
}

/** Miejscowość z ulicą do opisu trasy: „Gdańsk, Grunwaldzka”. */
export const placeLabel = (place: Pick<Place, 'street' | 'city'>) => [place.city.trim(), streetName(place.street ?? '')].filter(Boolean).join(', ');

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

/**
 * Dni w najbliższych dwóch tygodniach, w które jest już zabieg w pobliżu. Proponowana godzina to koniec tamtego
 * zabiegu (jego czas trwania) plus dojazd, a gdy to za późno albo koliduje: czas przed nim. Godzina musi zmieścić
 * się w całym planie dnia: nowy zabieg (jego czas trwania) z dojazdami nie może nachodzić na żaden inny zabieg tego
 * dnia. Gdy przy najbliższym zabiegu się nie da, pierwsza wolna godzina tego dnia.
 */
export function suggestSlots(
  target: LatLng,
  durationMin: number,
  today: string,
  planned: Array<{ order: Order; visit: Visit; point: LatLng | null }>,
): Suggestion[] {
  const limit = addDays(today, 14);
  const nowMin = toMin(nowWarsaw().slice(11, 16));
  const active = planned.filter(({ visit }) => visit.start && visit.status === 'zaplanowany');
  const best = new Map<string, Suggestion>();
  for (const item of active) {
    const { visit, point } = item;
    if (!point) continue;
    const date = visit.start!.slice(0, 10);
    if (date < today || date > limit) continue;
    const distanceKm = haversineKm(target, point);
    if (distanceKm > MAX_DISTANCE_KM) continue;
    const current = best.get(date);
    if (current && current.distanceKm <= distanceKm) continue;
    const travelMin = travelMinutes(distanceKm);
    // Cały plan dnia: każdy zabieg z jego czasem trwania i położeniem (dojazdy w obie strony).
    const stops: DayStop[] = active
      .filter((p) => p.visit.start!.slice(0, 10) === date)
      .map((p) => ({ start: p.visit.start!, durationMin: p.visit.durationMin || 60, label: '', city: '', point: p.point }));
    const fits = (startMin: number) => {
      if (startMin < toMin(WORK_START) || startMin + durationMin > toMin(WORK_END)) return false;
      if (date === today && startMin < nowMin) return false;
      return !stops.some((st) => {
        const s0 = toMin(st.start.slice(11, 16));
        const s1 = s0 + st.durationMin;
        return startMin < s1 + drive(st.point, target) && startMin + durationMin + drive(target, st.point) > s0;
      });
    };
    const near0 = toMin(visit.start!.slice(11, 16));
    const after = Math.ceil((near0 + (visit.durationMin || 60) + travelMin) / 15) * 15;
    const before = Math.floor((near0 - durationMin - travelMin) / 15) * 15;
    let startMin = [after, before].find(fits);
    if (startMin === undefined) {
      const free = freeSlots(stops, target, durationMin, date === today ? { nowMin } : {})[0];
      if (!free) continue;
      startMin = toMin(free);
    }
    best.set(date, { start: `${date}T${toHhmm(startMin)}`, date, distanceKm, travelMin, near: { order: item.order, visit } });
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

/** Dni na kolejny zabieg: 8–12 dni po poprzednim (zabieg II po I, III po II), bez niedziel. */
export function nextVisitDays(after: string): string[] {
  return [8, 9, 10, 11, 12].map((n) => addDays(after, n)).filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0);
}

/** Dzień poprzedniego zabiegu, od którego liczą się propozycje kolejnego: wykonany albo umówiony termin. */
export function previousVisitDay(list: Visit[], seq: number): string | null {
  const prev = list.filter((v) => v.seq < seq && v.status !== 'odwolany').sort((a, b) => b.seq - a.seq)[0];
  return prev ? (prev.doneOn ?? prev.start?.slice(0, 10) ?? null) : null;
}
