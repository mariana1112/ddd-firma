import type { Order } from './types';

type AddressParts = Pick<Order, 'street' | 'houseNo' | 'postalCode' | 'city'>;

/** Adres do map: „Piotrkowska 12, 90-001 Łódź, Polska”. Kraj pomaga mapom, gdy ulica istnieje też za granicą. */
export function mapsQuery(order: AddressParts): string {
  const parts = [`${order.street.trim()} ${order.houseNo.trim()}`.trim(), `${order.postalCode.trim()} ${order.city.trim()}`.trim()].filter(Boolean);
  return parts.length ? [...parts, 'Polska'].join(', ') : '';
}

/** Czy tekst to link do Google Maps (pełny albo skrócony z „Udostępnij”). */
export function isMapsLink(value: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i.test(value.trim());
}

/** Współrzędne z linku Google Maps, jeśli link je zawiera (pełne linki tak, skrócone maps.app.goo.gl nie). */
export function coordsFromLink(link: string | undefined): { lat: number; lng: number } | null {
  if (!link) return null;
  const patterns = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|daddr|destination|ll)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i];
  for (const re of patterns) {
    const m = re.exec(link);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

/** Wyszukanie adresu w Google Maps, żeby sprawdzić, czy wskazuje właściwe miejsce. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export interface NavTarget {
  id: 'google' | 'google-app' | 'apple';
  label: string;
  url: string;
  /** Link do aplikacji (schemat), otwierany w tej samej karcie. */
  app: boolean;
}

/**
 * Linki nawigacji do adresu zlecenia. Zapisany link do miejsca z Google Maps ma pierwszeństwo: Google otwiera dokładnie
 * to miejsce, a jego współrzędne (jeśli są w linku) dostają też inne mapy. Na iPhonie dochodzi aplikacja Google Maps
 * i Apple Mapy, bo strona google.com z aplikacji na ekranie początkowym otwiera się w przeglądarce.
 */
export function navigationTargets(order: AddressParts & Pick<Order, 'mapsLink'>, ios: boolean): NavTarget[] {
  const query = mapsQuery(order);
  const coords = coordsFromLink(order.mapsLink);
  const dest = coords ? `${coords.lat},${coords.lng}` : query;
  if (!dest && !order.mapsLink) return [];
  const enc = encodeURIComponent(dest);
  const google =
    order.mapsLink && !coords
      ? order.mapsLink.trim()
      : `https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=driving`;
  const targets: NavTarget[] = [];
  if (ios && dest) targets.push({ id: 'google-app', label: 'Google Maps (aplikacja)', url: `comgooglemaps://?daddr=${enc}&directionsmode=driving`, app: true });
  targets.push({ id: 'google', label: ios ? 'Google Maps (przeglądarka)' : 'Google Maps', url: google, app: false });
  if (ios && dest) targets.push({ id: 'apple', label: 'Apple Mapy', url: `https://maps.apple.com/?daddr=${enc}&dirflg=d`, app: true });
  return targets;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ---------- Adres z linku (albo udostępnionego tekstu) Google Maps ----------

export interface ParsedAddress {
  street: string;
  houseNo: string;
  flatNo: string;
  postalCode: string;
  city: string;
}

const STREET_RE = /^(?:ul\.?|ulica)?\s*(.+?)\s+(\d+[a-zA-Z]?)(?:\s*\/\s*(\d+[a-zA-Z]?)|\s+(?:m\.?|lok\.?)\s*(\d+[a-zA-Z]?))?$/i;

/**
 * Adres z tekstu Google Maps: „Długa 47/3, 80-831 Gdańsk, Polska”, „Restauracja X, Długa 47, 80-831 Gdańsk”
 * albo „Długa 47, Gdańsk”. Null, gdy nie ma w nim ani ulicy z numerem, ani miejscowości.
 */
export function parseAddressText(text: string): ParsedAddress | null {
  const clean = text.replace(/\s+/g, ' ').replace(/,?\s*(Polska|Poland)\s*$/i, '').trim();
  if (!clean || /^https?:\/\//i.test(clean)) return null;
  const segs = clean.split(',').map((s) => s.trim()).filter(Boolean);
  let postalCode = '';
  let city = '';
  const postalAt = segs.findIndex((s) => /^\d{2}-\d{3}\b/.test(s));
  if (postalAt >= 0) {
    const m = /^(\d{2}-\d{3})\s*(.*)$/.exec(segs[postalAt])!;
    postalCode = m[1];
    city = m[2].trim();
  }
  const candidates = postalAt >= 0 ? segs.slice(0, postalAt) : segs;
  let street = '';
  let houseNo = '';
  let flatNo = '';
  for (let i = candidates.length - 1; i >= 0; i--) {
    const m = STREET_RE.exec(candidates[i]);
    if (m) {
      street = m[1].trim();
      houseNo = m[2];
      flatNo = m[3] ?? m[4] ?? '';
      // Bez kodu pocztowego miejscowość to zwykle ostatni fragment po ulicy.
      if (!city && postalAt < 0 && i < segs.length - 1) city = segs[segs.length - 1];
      break;
    }
  }
  if (!city && postalAt < 0 && !street && segs.length === 1) city = segs[0];
  if (!street && !city) return null;
  return { street, houseNo, flatNo, postalCode, city };
}

/** Pierwszy link w tekście (udostępnienie z Google Maps to często „nazwa, adres” + link). */
export function firstUrl(text: string): string {
  return /https?:\/\/\S+/i.exec(text)?.[0].replace(/[),.]+$/, '') ?? '';
}

/** Skrócony link z „Udostępnij” (maps.app.goo.gl): nie ma w nim ani adresu, ani współrzędnych. */
export const isShortMapsLink = (url: string) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url.trim());

/**
 * Co da się odczytać z wklejonego tekstu Google Maps bez internetu: link do zapisania, adres (z tekstu obok
 * linku, z nazwy miejsca w linku albo z wyszukiwanej frazy) i współrzędne.
 */
export function readMapsInput(input: string): { url: string; address: ParsedAddress | null; coords: { lat: number; lng: number } | null } {
  const url = firstUrl(input);
  const text = url ? input.replace(url, ' ').trim() : input.trim();
  let address = text ? parseAddressText(text) : null;
  if (!address && url) {
    const place = /\/maps\/place\/([^/@?]+)/.exec(url)?.[1];
    if (place) address = parseAddressText(decodeURIComponent(place.replace(/\+/g, ' ')));
  }
  if (!address && url) {
    try {
      const params = new URL(url).searchParams;
      const q = params.get('q') ?? params.get('query') ?? params.get('destination') ?? params.get('daddr') ?? '';
      if (q && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(q.trim())) address = parseAddressText(q);
    } catch {
      // Niepoprawny link: zostaje bez adresu.
    }
  }
  return { url, address, coords: url ? coordsFromLink(url) : null };
}
