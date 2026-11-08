import { describe, expect, it } from 'vitest';
import { dateTile, dayHeading, groupByDay, orderTerm, sortOrderRows, type OrderListRow } from './order-list';
import type { Order, Visit } from './types';

const visit = (over: Partial<Visit>): Visit => ({ seq: 1, status: 'zaplanowany', start: null, doneOn: null, ...over }) as Visit;
const row = (number: number, ...visits: Visit[]): OrderListRow => ({ order: { id: String(number), number } as Order, visits });

describe('lista zleceń według daty', () => {
  const rows = [
    row(1, visit({ start: '2026-11-10T12:00' })),
    row(2, visit({ start: '2026-11-08T10:00' })),
    row(3, visit({ start: null })),
    row(4, visit({ start: '2026-11-10T09:00' })),
    row(5, visit({ status: 'wykonany', start: '2026-10-30T09:00', doneOn: '2026-10-31' })),
    row(6, visit({ status: 'wykonany', start: '2026-11-02T08:00', doneOn: '2026-11-02' }), visit({ seq: 2, start: '2026-11-16T08:00' })),
  ];

  it('termin: zabieg do zrobienia, a po wszystkich dzień wykonania', () => {
    expect(orderTerm(rows[0].visits)).toEqual({ date: '2026-11-10', time: '12:00' });
    expect(orderTerm(rows[2].visits)).toEqual({ date: null, time: null });
    expect(orderTerm(rows[4].visits)).toEqual({ date: '2026-10-31', time: null });
    expect(orderTerm(rows[5].visits)).toEqual({ date: '2026-11-16', time: '08:00' });
  });

  it('sortuje rosnąco i malejąco, bez terminu na końcu', () => {
    const numbers = (list: OrderListRow[]) => list.map((r) => r.order.number);
    expect(numbers(sortOrderRows(rows, 'najwczesniej'))).toEqual([5, 2, 4, 1, 6, 3]);
    expect(numbers(sortOrderRows(rows, 'najpozniej'))).toEqual([6, 1, 4, 2, 5, 3]);
    expect(numbers(sortOrderRows(rows, 'numer'))).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('grupuje po dniach i opisuje dzień', () => {
    const groups = groupByDay(sortOrderRows(rows, 'najwczesniej'));
    expect(groups.map((g) => [g.date, g.rows.length])).toEqual([
      ['2026-10-31', 1],
      ['2026-11-08', 1],
      ['2026-11-10', 2],
      ['2026-11-16', 1],
      [null, 1],
    ]);
    expect(dayHeading('2026-11-08', '2026-11-08')).toBe('Dziś · niedziela, 8 listopada');
    expect(dayHeading('2026-11-09', '2026-11-08')).toBe('Jutro · poniedziałek, 9 listopada');
    expect(dayHeading('2027-01-04', '2026-11-08')).toBe('poniedziałek, 4 stycznia 2027');
    expect(dayHeading(null, '2026-11-08')).toBe('Termin do umówienia');
    expect(dateTile('2026-11-08')).toEqual({ weekday: 'nd', day: '8', month: 'lis' });
  });
});
