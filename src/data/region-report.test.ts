import { describe, expect, it } from 'vitest';
import { byTechnician, initials, technicianLines } from './reports';
import type { Visit } from './types';

const v = (technicianId: string, technicianName: string, amount: number) => ({ visit: { technicianId, technicianName, amount } as Visit, order: undefined });

describe('raport regionu z podziałem na techników', () => {
  it('inicjały i imię; przy dwóch osobach o tym samym imieniu litera nazwiska', () => {
    expect(initials('Maciej Kowalski')).toBe('MK');
    expect(initials('Maurycy')).toBe('MA');
    const shares = byTechnician({
      visits: [v('u1', 'Maciej Kowalski', 40000), v('u2', 'Ania Nowak', 30000), v('u1', 'Maciej Kowalski', 35000), v('u3', 'Maciej Lis', 20000)],
    });
    expect(shares.map((s) => [s.label, s.visits, s.turnover])).toEqual([
      ['Maciej K.', 2, 75000],
      ['Ania', 1, 30000],
      ['Maciej L.', 1, 20000],
    ]);
    expect(technicianLines(shares)[0]).toBe('Maciej K. – 2 zabiegi, 750 zł');
  });
});
