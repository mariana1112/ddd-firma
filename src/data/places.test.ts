import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressFromComponents, pickAddress, suggestAddresses } from './places';

afterEach(() => vi.unstubAllGlobals());

describe('podpowiedzi adresów Google', () => {
  it('zapytanie: tylko wpisany tekst, Polska, okolica bazy, token sesji i klucz w nagłówku', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          suggestions: [
            { placePrediction: { placeId: 'p1', text: { text: 'Świętego Jana, Gdańsk, Polska' }, structuredFormat: { mainText: { text: 'Świętego Jana' }, secondaryText: { text: 'Gdańsk, Polska' } } } },
            { queryPrediction: { text: { text: 'świętego jana' } } },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const list = await suggestAddresses({ key: 'K', input: ' świętego jana ', session: 'S', near: { lat: 54.35, lng: 18.65 } });
    expect(list).toEqual([{ placeId: 'p1', main: 'Świętego Jana', secondary: 'Gdańsk, Polska' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('K');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ input: 'świętego jana', sessionToken: 'S', languageCode: 'pl', includedRegionCodes: ['pl'] });
    expect(body.locationBias.circle.radius).toBe(50000);
  });

  it('mniej niż 3 znaki: bez zapytania', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await suggestAddresses({ key: 'K', input: 'św', session: 'S' })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wybór: tylko pola adresu i położenia (Essentials), ten sam token sesji', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          addressComponents: [
            { longText: '5', types: ['street_number'] },
            { longText: 'Świętego Jana', types: ['route'] },
            { longText: 'Gdańsk', types: ['locality', 'political'] },
            { longText: '80-833', types: ['postal_code'] },
          ],
          location: { latitude: 54.3489, longitude: 18.6553 },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = await pickAddress({ key: 'K', placeId: 'p1', session: 'S' });
    expect(a).toEqual({ street: 'Świętego Jana', houseNo: '5', flatNo: '', postalCode: '80-833', city: 'Gdańsk', point: { lat: 54.3489, lng: 18.6553 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/places/p1?');
    expect(url).toContain('sessionToken=S');
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('addressComponents,location');
  });

  it('wieś bez „locality”: miejscowość z poziomu gminy; zły klucz: zrozumiały błąd', async () => {
    expect(addressFromComponents([{ longText: 'Pruszcz', types: ['administrative_area_level_3'] }]).city).toBe('Pruszcz');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    await expect(suggestAddresses({ key: 'zly', input: 'Długa', session: 'S' })).rejects.toThrow(/Klucz Google nie działa/);
  });
});
