import { describe, expect, it } from 'vitest';
import { homeBase, routeText, suggestRoutes } from './mileage';

describe('trasy przejazdów', () => {
  it('„Gdańsk, Gdańsk” to jeden Gdańsk; pisownia miejscowości poprawiona', () => {
    expect(routeText(['gdansk', 'Gdańsk'])).toBe('Gdańsk');
    expect(routeText(['Gdańsk', 'gdynia', 'Gdańsk'])).toBe('Gdańsk - Gdynia - Gdańsk');
  });

  it('propozycja: z bazy przez miejscowości zabiegów i z powrotem, potem ostatnie trasy', () => {
    const recent = [
      { from: 'Gdańsk', via: '', to: 'Sopot' },
      { from: 'Gdańsk', via: 'Gdynia', to: 'Gdańsk' },
    ];
    expect(homeBase(recent)).toBe('Gdańsk');
    expect(suggestRoutes({ base: 'Gdańsk', visitCities: ['Gdynia', 'Gdynia'], recent })).toEqual([
      ['Gdańsk', 'Gdynia', 'Gdańsk'],
      ['Gdańsk', 'Sopot'],
    ]);
    // Same zabiegi w bazie: jedna miejscowość.
    expect(suggestRoutes({ base: 'Gdańsk', visitCities: ['Gdańsk'], recent: [] })).toEqual([['Gdańsk']]);
  });
});
