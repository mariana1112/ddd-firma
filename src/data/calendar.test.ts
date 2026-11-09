import { describe, expect, it } from 'vitest';
import { googleCalendarUrl } from './calendar';
import type { Order } from './types';

const order = {
  number: 42,
  prefix: 'GDA',
  clientName: 'Jan Kowalski',
  pest: 'karaluchy',
  pestOther: '',
  street: 'Długa',
  houseNo: '5',
  flatNo: '3',
  building: 'blok',
  city: 'Gdańsk',
  postalCode: '80-001',
  phones: [{ number: '505 724 090', label: '' }],
} as unknown as Order;

describe('Kalendarz Google', () => {
  it('gotowe wydarzenie: numer zlecenia, czas trwania, adres i telefon', () => {
    const url = new URL(googleCalendarUrl(order, { seq: 2, start: '2026-11-10T10:00', durationMin: 90 })!);
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261110T100000/20261110T113000');
    expect(url.searchParams.get('ctz')).toBe('Europe/Warsaw');
    expect(url.searchParams.get('text')).toMatch(/^GDA-0042\/II /);
    expect(url.searchParams.get('text')).toContain('Jan Kowalski');
    expect(url.searchParams.get('location')).toBe('Długa 5/3, Gdańsk, 80-001');
    expect(url.searchParams.get('details')).toBe('Zabieg II\nTel. 505 724 090');
  });

  it('bez terminu nie ma linku', () => {
    expect(googleCalendarUrl(order, { seq: 1, start: null, durationMin: 60 })).toBeNull();
  });
});
