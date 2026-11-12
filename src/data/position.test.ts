import { describe, expect, it } from 'vitest';
import { addressFromNominatim, pointMapsLink } from './geo';
import { coordsFromLink, isMapsLink } from './maps';

describe('aktualna pozycja w nowym zleceniu', () => {
  it('adres z odpowiedzi mapy: ulica, numer, kod, miejscowość (także wieś)', () => {
    expect(addressFromNominatim({ road: 'Długa', house_number: '47', postcode: '80-831', city: 'Gdańsk' })).toEqual({ street: 'Długa', houseNo: '47', postalCode: '80-831', city: 'Gdańsk' });
    expect(addressFromNominatim({ road: 'Polna', postcode: '83-010', village: 'Straszyn' })).toEqual({ street: 'Polna', houseNo: '', postalCode: '83-010', city: 'Straszyn' });
  });

  it('link do punktu działa jak link Google Maps i daje dokładne współrzędne do nawigacji', () => {
    const link = pointMapsLink({ lat: 54.348712, lng: 18.653012 });
    expect(isMapsLink(link)).toBe(true);
    expect(coordsFromLink(link)).toEqual({ lat: 54.348712, lng: 18.653012 });
  });
});
