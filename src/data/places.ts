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

function explain(status: number): PlacesError {
  if (status === 400) return new PlacesError('Google nie rozumie zapytania.');
  if (status === 403 || status === 401) return new PlacesError('Klucz Google nie działa: sprawdź, czy jest włączone „Places API (New)” i czy klucz pozwala na tę stronę.');
  if (status === 429) return new PlacesError('Dzienny limit podpowiedzi Google wyczerpany. Wpisz adres ręcznie.');
  return new PlacesError('Podpowiedzi Google chwilowo nie działają. Wpisz adres ręcznie.');
}

/** Podpowiedzi adresów w Polsce, najpierw w okolicy (bias), dla wpisanego tekstu. */
export async function suggestAddresses(opts: { key: string; input: string; session: string; near?: LatLng | null; signal?: AbortSignal }): Promise<AddressSuggestion[]> {
  const input = opts.input.trim();
  if (input.length < 3) return [];
  const body: Record<string, unknown> = { input, sessionToken: opts.session, languageCode: 'pl', includedRegionCodes: ['pl'] };
  if (opts.near) body.locationBias = { circle: { center: { latitude: opts.near.lat, longitude: opts.near.lng }, radius: 50000 } };
  const response = await fetch(`${API}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': opts.key },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok) throw explain(response.status);
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
  const response = await fetch(`${API}/places/${encodeURIComponent(opts.placeId)}?${params}`, {
    headers: { 'X-Goog-Api-Key': opts.key, 'X-Goog-FieldMask': 'addressComponents,location' },
  });
  if (!response.ok) throw explain(response.status);
  const json = (await response.json()) as { addressComponents?: Component[]; location?: { latitude?: number; longitude?: number } };
  return addressFromComponents(json.addressComponents ?? [], json.location);
}
