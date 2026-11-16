import { describe, expect, it } from 'vitest';
import { nextVisitDays, previousVisitDay } from './geo';
import type { Visit } from './types';

describe('termin kolejnego zabiegu', () => {
  it('8–12 dni po poprzednim, bez niedziel', () => {
    expect(nextVisitDays('2026-11-16')).toEqual(['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']);
    expect(nextVisitDays('2026-11-14')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']);
  });

  it('liczy od poprzedniego zabiegu: wykonanego albo umówionego, bez odwołanych', () => {
    const v = (seq: number, extra: Partial<Visit>) => ({ seq, status: 'zaplanowany', start: null, doneOn: null, ...extra }) as Visit;
    const list = [v(1, { status: 'wykonany', doneOn: '2026-11-10' }), v(2, { start: '2026-11-20T10:00' }), v(3, { status: 'odwolany', start: '2026-12-01T10:00' })];
    expect(previousVisitDay(list, 2)).toBe('2026-11-10');
    expect(previousVisitDay(list, 3)).toBe('2026-11-20');
    expect(previousVisitDay(list, 4)).toBe('2026-11-20');
    expect(previousVisitDay(list, 1)).toBeNull();
  });
});
