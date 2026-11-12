import { describe, expect, it } from 'vitest';
import { freeSlots, type DayStop } from './geo';

const stop = (start: string): DayStop => ({ start: `2026-11-20T${start}`, durationMin: 60, label: 'X', city: 'Gdańsk', point: null });

describe('wolne godziny przy umawianiu', () => {
  it('po każdym zabiegu z dojazdem (bez położenia 30 min), tak żeby zdążyć na kolejny', () => {
    expect(freeSlots([stop('09:00'), stop('13:00')], null, 60)).toEqual(['10:30', '14:30']);
  });

  it('dziś nie wcześniej niż teraz; pusty dzień od 8:00', () => {
    expect(freeSlots([stop('09:00'), stop('13:00')], null, 60, { nowMin: 11 * 60 })).toEqual(['11:00', '14:30']);
    expect(freeSlots([], null, 90)).toEqual(['08:00']);
  });
});
