import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addPastVisit, duplicateOrder, orderVisits } from './orders';
import { buildReport, periodOf } from './reports';
import { orders, visits } from './repo';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('stare zlecenie dopisane do raportów', () => {
  it('nowe zakończone zlecenie z wykonanym zabiegiem w raporcie z dnia wykonania', async () => {
    const { order, visit, created } = await addPastVisit({
      phone: '+48 500 600 700',
      doneOn: '2026-11-09',
      amount: 35000,
      payMethod: 'blik',
      seq: 1,
      technician: { id: 'u1', name: 'Maciej Kowalski' },
    });
    expect(created).toBe(true);
    expect(order).toMatchObject({ closed: true, priceMin: null, priceMax: null, phones: [{ number: '+48 500 600 700', label: '' }] });
    expect(visit).toMatchObject({ status: 'wykonany', doneOn: '2026-11-09', amount: 35000, payMethod: 'blik', technicianName: 'Maciej Kowalski' });
    const report = buildReport(periodOf('dzien', '2026-11-09'), { visits: await visits.all(), orders: await orders.all(), expenses: [], trips: [] });
    expect(report.turnover).toBe(35000);
    expect(report.byMethod.blik).toBe(35000);
  });

  it('z numerem istniejącego zlecenia: zabieg II dopisuje się do niego', async () => {
    const first = await addPastVisit({ phone: '500600700', doneOn: '2026-11-02', amount: 30000, payMethod: 'gotowka', seq: 1, technician: { id: 'u1', name: 'Ania' } });
    const second = await addPastVisit({
      phone: '500600700',
      doneOn: '2026-11-09',
      amount: 25000,
      payMethod: 'przelew',
      seq: 2,
      technician: { id: 'u1', name: 'Ania' },
      orderNumber: first.order.number,
    });
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect((await orderVisits(first.order.id)).map((v) => [v.seq, v.doneOn, v.amount])).toEqual([
      [1, '2026-11-02', 30000],
      [2, '2026-11-09', 25000],
    ]);
  });
});

describe('powielenie zlecenia', () => {
  it('te same dane na inny termin: nowy numer, inny lokal, zabieg I umówiony', async () => {
    const { order } = await addPastVisit({ phone: '500600700', doneOn: '2026-11-09', amount: 30000, payMethod: 'gotowka', seq: 1, technician: { id: 'u1', name: 'Ania' }, street: 'Długa', houseNo: '5', city: 'Gdańsk', pest: 'pluskwy' });
    const copy = await duplicateOrder(order.id, { start: '2026-11-20T12:00', durationMin: 60, flatNo: '7' });
    expect(copy.number).toBe(order.number + 1);
    expect(copy).toMatchObject({ street: 'Długa', houseNo: '5', flatNo: '7', city: 'Gdańsk', pest: 'pluskwy', closed: false });
    expect(copy.phones).toEqual(order.phones);
    expect((await orderVisits(copy.id)).map((v) => [v.seq, v.status, v.start])).toEqual([[1, 'zaplanowany', '2026-11-20T12:00']]);
  });
});
