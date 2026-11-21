import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { haversineKm, locatePlace, placeLabel, streetName } from './geo';

describe('położenie zlecenia po ulicy', () => {
  const calls: string[] = [];
  beforeEach(async () => {
    await db.delete();
    await db.open();
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const q = new URL(url).searchParams;
        const street = q.get('street');
        // Przymorze, Morena i środek Gdańska; nieznana ulica: brak wyniku.
        const hits: Record<string, [string, string]> = { Obrońców: ['54.4100', '18.5950'], Myśliwska: ['54.3560', '18.5810'] };
        const hit = street ? hits[street.split(' ')[0]] : ['54.3520', '18.6466'];
        return new Response(JSON.stringify(hit ? [{ lat: hit[0], lon: hit[1] }] : []), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('nazwa ulicy bez „ul.” i bez numeru domu', () => {
    expect(streetName('ul. Grunwaldzka 12')).toBe('Grunwaldzka');
    expect(streetName('Obrońców Wybrzeża 4/12')).toBe('Obrońców Wybrzeża');
    expect(streetName('Al. Grunwaldzka')).toBe('Al. Grunwaldzka');
    expect(placeLabel({ city: 'Gdańsk', street: 'ul. Myśliwska 5' })).toBe('Gdańsk, Myśliwska');
  });

  it('Przymorze i Morena to różne miejsca; do map nie trafia numer domu', async () => {
    const przymorze = await locatePlace({ street: 'Obrońców Wybrzeża', city: 'Gdańsk', postalCode: '80-398' });
    const morena = await locatePlace({ street: 'ul. Myśliwska 5', city: 'Gdańsk', postalCode: '80-283' });
    expect(haversineKm(przymorze!, morena!)).toBeGreaterThan(5);
    expect(calls.some((u) => /street=My%C5%9Bliwska(&|$)/.test(u))).toBe(true);
    expect(calls.every((u) => !/\d/.test(new URL(u).searchParams.get('street') ?? ''))).toBe(true);
  });

  it('punkt z linku Google Maps bez pytania map; ponowne sprawdzenie ulicy z pamięci', async () => {
    const pin = await locatePlace({ street: 'Długa', city: 'Gdańsk', postalCode: '', mapsLink: 'https://www.google.com/maps/search/?api=1&query=54.348600,18.653200' });
    expect(pin).toEqual({ lat: 54.3486, lng: 18.6532 });
    expect(calls).toHaveLength(0);
    await locatePlace({ street: 'Myśliwska', city: 'Gdańsk', postalCode: '80-283' });
    await locatePlace({ street: 'Myśliwska', city: 'Gdańsk', postalCode: '80-283' });
    expect(calls).toHaveLength(1);
  });

  it('nieznana ulica: środek miejscowości', async () => {
    const point = await locatePlace({ street: 'Nieistniejąca', city: 'Gdańsk', postalCode: '' });
    expect(point).toEqual({ lat: 54.352, lng: 18.6466 });
  });
});
