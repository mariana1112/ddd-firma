import { describe, expect, it } from 'vitest';
import { coordsFromLink, isMapsLink, mapsQuery, navigationTargets } from './maps';

const addr = { street: 'Piotrkowska', houseNo: '12', postalCode: '90-001', city: 'Łódź' };

describe('nawigacja do adresu zlecenia', () => {
  it('adres z kodem i krajem, rozpoznawanie linków Google Maps i współrzędnych', () => {
    expect(mapsQuery(addr)).toBe('Piotrkowska 12, 90-001 Łódź, Polska');
    expect(mapsQuery({ street: '', houseNo: '', postalCode: '', city: '' })).toBe('');
    expect(isMapsLink('https://maps.app.goo.gl/AbC123')).toBe(true);
    expect(isMapsLink('https://www.google.com/maps/place/Piotrkowska/@51.7592,19.4560,17z')).toBe(true);
    expect(isMapsLink('https://example.com/maps')).toBe(false);
    expect(coordsFromLink('https://www.google.com/maps/place/X/@51.7592,19.456,17z/data=!3d51.75931!4d19.45602')).toEqual({ lat: 51.75931, lng: 19.45602 });
    expect(coordsFromLink('https://maps.google.com/?q=51.7,19.4')).toEqual({ lat: 51.7, lng: 19.4 });
    expect(coordsFromLink('https://maps.app.goo.gl/AbC123')).toBeNull();
  });

  it('na iPhonie aplikacja Google Maps i Apple Mapy; zapisany link ma pierwszeństwo', () => {
    const ios = navigationTargets({ ...addr, mapsLink: undefined }, true);
    expect(ios.map((t) => t.id)).toEqual(['google-app', 'google', 'apple']);
    expect(ios[0].url).toBe('comgooglemaps://?daddr=Piotrkowska%2012%2C%2090-001%20%C5%81%C3%B3d%C5%BA%2C%20Polska&directionsmode=driving');
    expect(ios.find((t) => t.id === 'apple')!.url).toContain('maps.apple.com/?daddr=Piotrkowska');

    const android = navigationTargets({ ...addr, mapsLink: 'https://maps.app.goo.gl/AbC123' }, false);
    expect(android.map((t) => t.id)).toEqual(['google']);
    expect(android[0].url).toBe('https://maps.app.goo.gl/AbC123');

    const withCoords = navigationTargets({ ...addr, mapsLink: 'https://www.google.com/maps/@51.75,19.45,17z' }, false);
    expect(withCoords[0].url).toBe('https://www.google.com/maps/dir/?api=1&destination=51.75%2C19.45&travelmode=driving');
  });
});
