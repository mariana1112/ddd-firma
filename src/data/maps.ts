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
  id: 'google' | 'google-app' | 'apple' | 'waze';
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
  if (dest) {
    targets.push({
      id: 'waze',
      label: 'Waze',
      url: coords ? `https://waze.com/ul?ll=${coords.lat},${coords.lng}&navigate=yes` : `https://waze.com/ul?q=${enc}&navigate=yes`,
      app: false,
    });
  }
  return targets;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
