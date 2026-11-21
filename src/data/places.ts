// Podpowiedzi adresów z Google Maps (Places API (New)): wpisujesz fragment adresu, wybierasz z listy, a ulica, numer,
// kod, miejscowość i dokładny punkt na mapie wpisują się same.
//
// Koszty: podpowiedzi i szczegóły adresu łączy „sesja” (token), więc Google liczy najwyżej 12 podpowiedzi na jedno
// wyszukanie. Szczegóły pobieramy tylko w polach Essentials (adres i położenie), najtańszych. Do Google trafia tylko
// to, co wpisano w polu wyszukiwania (bez danych klienta). Klucz ustawia admin w Ustawieniach (dane firmy).
import type { LatLng } from './geo';

const API = 'https://places.googleapis.com/v1';

export interface AddressSuggestion {
  placeId: string;
  main: string;
  secondary: string;
}

export interface PickedAddress {
  street: string;
  houseNo: string;
  flatNo: string;
  postalCode: string;
  city: string;
  point: LatLng | null;
}

export class PlacesError extends Error {}

/** Nowa sesja wyszukiwania (jeden adres): podpowiedzi i wybór liczone razem. */
export const newPlacesSession = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Powód błędu z odpowiedzi Google (np. API_KEY_INVALID), żeby komunikat mówił, co poprawić. */
export function explainPlacesError(status: number, body: unknown): PlacesError {
  const err = (body && typeof body === 'object' ? (body as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } }).error : undefined) ?? {};
  const reason = err.details?.find((d) => d.reason)?.reason ?? err.status ?? '';
  const code = ` (${status}${reason ? ` ${reason}` : ''})`;
  if (reason === 'API_KEY_INVALID') return new PlacesError(`Klucz Google jest nieprawidłowy: wklej go jeszcze raz w Ustawieniach, w całości${code}.`);
  if (reason === 'API_KEY_HTTP_REFERRER_BLOCKED') return new PlacesError(`Klucz Google nie pozwala na tę stronę: w Google Cloud dodaj stronę aplikacji w ograniczeniach klucza (zmiana działa do 5 minut)${code}.`);
  if (reason === 'API_KEY_SERVICE_BLOCKED') return new PlacesError(`Klucz Google nie obejmuje Places API (New): dodaj je w ograniczeniach klucza${code}.`);
  if (reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(err.message ?? '')) return new PlacesError(`Places API (New) jest wyłączone w projekcie Google Cloud${code}.`);
  if (/billing/i.test(err.message ?? '') || reason === 'BILLING_DISABLED') return new PlacesError(`Projekt Google Cloud nie ma aktywnego konta rozliczeniowego${code}.`);
  if (status === 429) return new PlacesError(`Dzienny limit podpowiedzi Google wyczerpany. Wpisz adres ręcznie${code}.`);
  if (status === 400) return new PlacesError(`Google odrzucił zapytanie: ${err.message ?? 'nieznany powód'}${code}.`);
  if (status === 403 || status === 401) return new PlacesError(`Google odmówił dostępu: ${err.message ?? 'sprawdź klucz'}${code}.`);
  return new PlacesError(`Podpowiedzi Google chwilowo nie działają. Wpisz adres ręcznie${code}.`);
}

async function explain(response: Response): Promise<PlacesError> {
  const body = await response.json().catch(() => null);
  return explainPlacesError(response.status, body);
}

/** Błąd sieci (brak internetu, zablokowane połączenie) zamiast błędu Google. */
async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new PlacesError('Brak połączenia z Google (internet albo blokada sieci). Wpisz adres ręcznie.');
  }
}

/** Podpowiedzi adresów w Polsce, najpierw w okolicy (bias), dla wpisanego tekstu. */
export async function suggestAddresses(opts: { key: string; input: string; session: string; near?: LatLng | null; signal?: AbortSignal }): Promise<AddressSuggestion[]> {
  const input = opts.input.trim();
  if (input.length < 3) return [];
  const body: Record<string, unknown> = { input, sessionToken: opts.session, languageCode: 'pl', includedRegionCodes: ['pl'] };
  if (opts.near) body.locationBias = { circle: { center: { latitude: opts.near.lat, longitude: opts.near.lng }, radius: 50000 } };
  const response = await call(`${API}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': opts.key },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok) throw await explain(response);
  const json = (await response.json()) as {
    suggestions?: Array<{ placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }>;
  };
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }));
}

type Component = { longText?: string; shortText?: string; types?: string[] };

/** Pola formularza z części adresu Google (ulica, numer, lokal, kod, miejscowość). */
export function addressFromComponents(components: Component[], location?: { latitude?: number; longitude?: number } | null): PickedAddress {
  const get = (...types: string[]) => {
    for (const type of types) {
      const hit = components.find((c) => c.types?.includes(type));
      if (hit?.longText) return hit.longText;
    }
    return '';
  };
  return {
    street: get('route'),
    houseNo: get('street_number', 'premise'),
    flatNo: get('subpremise'),
    postalCode: get('postal_code'),
    city: get('locality', 'postal_town', 'administrative_area_level_3', 'sublocality'),
    point: location && typeof location.latitude === 'number' && typeof location.longitude === 'number' ? { lat: location.latitude, lng: location.longitude } : null,
  };
}

/** Wybrany adres: części adresu i punkt (pola Essentials). Kończy sesję wyszukiwania. */
export async function pickAddress(opts: { key: string; placeId: string; session: string }): Promise<PickedAddress> {
  const params = new URLSearchParams({ languageCode: 'pl', sessionToken: opts.session });
  const response = await call(`${API}/places/${encodeURIComponent(opts.placeId)}?${params}`, {
    headers: { 'X-Goog-Api-Key': opts.key, 'X-Goog-FieldMask': 'addressComponents,location' },
  });
  if (!response.ok) throw await explain(response);
  const json = (await response.json()) as { addressComponents?: Component[]; location?: { latitude?: number; longitude?: number } };
  return addressFromComponents(json.addressComponents ?? [], json.location);
}
