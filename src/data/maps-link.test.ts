import { describe, expect, it } from 'vitest';
import { isShortMapsLink, parseAddressText, readMapsInput } from './maps';

describe('adres z linku Google Maps', () => {
  it('tekst adresu: ulica z numerem i lokalem, kod, miejscowość; nazwa miejsca i kraj pominięte', () => {
    expect(parseAddressText('Długa 47/3, 80-831 Gdańsk, Polska')).toEqual({ street: 'Długa', houseNo: '47', flatNo: '3', postalCode: '80-831', city: 'Gdańsk' });
    expect(parseAddressText('Restauracja Pod Lipą, ul. Długa 47, 80-831 Gdańsk')).toMatchObject({ street: 'Długa', houseNo: '47', city: 'Gdańsk' });
    expect(parseAddressText('Stryjewskiego 33 m. 22, Gdańsk')).toEqual({ street: 'Stryjewskiego', houseNo: '33', flatNo: '22', postalCode: '', city: 'Gdańsk' });
    expect(parseAddressText('Sopot')).toMatchObject({ city: 'Sopot', street: '' });
  });

  it('udostępniony tekst z adresem i linkiem: link do zapisania i adres', () => {
    const r = readMapsInput('Długa 47, 80-831 Gdańsk\nhttps://maps.app.goo.gl/AbCdEf123');
    expect(r.url).toBe('https://maps.app.goo.gl/AbCdEf123');
    expect(r.address).toMatchObject({ street: 'Długa', houseNo: '47', postalCode: '80-831', city: 'Gdańsk' });
  });

  it('pełny link: adres z nazwy miejsca albo z wyszukiwania; współrzędne do nawigacji', () => {
    const place = readMapsInput('https://www.google.com/maps/place/D%C5%82uga+47,+80-831+Gda%C5%84sk/@54.3487,18.6530,17z/data=!3m1');
    expect(place.address).toMatchObject({ street: 'Długa', houseNo: '47', postalCode: '80-831', city: 'Gdańsk' });
    expect(place.coords).toEqual({ lat: 54.3487, lng: 18.653 });
    expect(readMapsInput('https://www.google.com/maps/search/?api=1&query=Grunwaldzka+82,+Gda%C5%84sk').address).toMatchObject({ street: 'Grunwaldzka', houseNo: '82', city: 'Gdańsk' });
    const coordsOnly = readMapsInput('https://www.google.com/maps/@54.3487,18.6530,17z');
    expect(coordsOnly.address).toBeNull();
    expect(coordsOnly.coords).toEqual({ lat: 54.3487, lng: 18.653 });
  });

  it('skrócony link bez tekstu: nie ma w nim adresu', () => {
    const r = readMapsInput('https://maps.app.goo.gl/AbCdEf123');
    expect(r.address).toBeNull();
    expect(isShortMapsLink(r.url)).toBe(true);
  });
});
